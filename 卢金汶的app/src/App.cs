using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace LedgerApp
{
    /// <summary>
    /// 记账本 —— 单文件本地记账应用。
    /// 内置 HTTP 服务与全部前端资源，数据保存在 exe 同目录的 data 文件夹。
    /// </summary>
    static class Program
    {
        static readonly Encoding Utf8 = new UTF8Encoding(false);
        static readonly object StateLock = new object();

        static string exeDir;
        static string dataDir;
        static string dataFile;
        static string backupDir;
        static string metaFile;

        static string stateRaw = "";
        static int rev = 1;
        static string lastBackupDay = "";
        static TcpListener listener;
        static int port = 8611;
        static bool headless;
        static volatile bool stopping;
        static Mutex instanceMutex;
        static bool noBrowser;
        static int startPort = 8611;

        const string AppResourcePrefix = "app.";
        const string DefaultStateResource = "res.default-state.json";

        [STAThread]
        static void Main(string[] args)
        {
            try
            {
                Run(args);
            }
            catch (Exception ex)
            {
                try
                {
                    string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                    File.WriteAllText(Path.Combine(dir, "crash.log"), DateTime.Now + "\r\n" + ex.ToString(), Utf8);
                }
                catch { }
            }
        }

        static void Run(string[] args)
        {
            try
            {
                ParseArgs(args);
            }
            catch (Exception ex)
            {
                Fail("参数错误：" + ex.Message);
                return;
            }

            exeDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            dataDir = string.IsNullOrEmpty(dataDir) ? Path.Combine(exeDir, "data") : dataDir;
            dataFile = Path.Combine(dataDir, "ledger.json");
            backupDir = Path.Combine(dataDir, "backup");
            metaFile = Path.Combine(dataDir, "meta.json");

            bool isFirstInstance = false;
            try
            {
                instanceMutex = new Mutex(false, DataMutexName());
                isFirstInstance = instanceMutex.WaitOne(0);
            }
            catch { isFirstInstance = true; }

            if (!isFirstInstance)
            {
                int waitCandidate;
                for (int i = 0; i < 20; i++)
                {
                    int running = FindExistingInstance(out waitCandidate);
                    if (running > 0)
                    {
                        if (!headless && !noBrowser) OpenBrowser(running);
                        return;
                    }
                    Thread.Sleep(250);
                }
                return;
            }

            int candidate;
            int existing = FindExistingInstance(out candidate);
            if (existing > 0)
            {
                if (!headless && !noBrowser) OpenBrowser(existing);
                return;
            }

            int bound = candidate > 0 ? candidate : FindFreePort(startPort, startPort + 9);
            if (bound == 0)
            {
                Fail("端口 " + startPort + " - " + (startPort + 9) + " 都被占用，无法启动。");
                return;
            }
            port = bound;

            try
            {
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
            }
            catch (Exception ex)
            {
                Fail("无法启动本地服务：" + ex.Message);
                return;
            }

            InitData();

            if (!headless && !noBrowser && !OpenBrowser(port))
            {
                Log("启动时无法自动打开浏览器，请在窗口里点击地址或复制到浏览器");
            }

            var acceptThread = new Thread(AcceptLoop) { IsBackground = true };
            acceptThread.Start();

            if (headless)
            {
                while (true) Thread.Sleep(1000);
            }
            else
            {
                RunWindow();
            }

            try { listener.Stop(); } catch { }
        }

        static void ParseArgs(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--headless") headless = true;
                else if (a == "--no-browser") noBrowser = true;
                else if (a == "--port" && i + 1 < args.Length) startPort = int.Parse(args[++i], CultureInfo.InvariantCulture);
                else if (a == "--data" && i + 1 < args.Length) dataDir = args[++i];
            }
        }

        static void Trace(string stage, string detail)
        {
            try
            {
                string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
                File.AppendAllText(Path.Combine(dir, "startup.log"),
                    DateTime.Now.ToString("HH:mm:ss.fff") + " [" + stage + "] " + detail + "\r\n", Utf8);
            }
            catch { }
        }

        static void Fail(string message)
        {
            if (headless) Console.Error.WriteLine(message);
            else MessageBox.Show(message, "记账本", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }

        // ======================= 服务循环 =======================
        static void AcceptLoop()
        {
            while (!stopping)
            {
                TcpClient client = null;
                try
                {
                    client = listener.AcceptTcpClient();
                    client.ReceiveTimeout = 5000;
                    client.SendTimeout = 5000;
                    using (var stream = client.GetStream())
                    {
                        HandleConnection(stream);
                    }
                }
                catch (IOException) { }
                catch (SocketException) { if (stopping) break; }
                catch (ObjectDisposedException) { break; }
                catch (InvalidOperationException) { break; }
                catch (Exception ex)
                {
                    if (stopping) break;
                    Log("请求处理异常：" + ex.Message);
                }
                finally
                {
                    try { if (client != null) client.Close(); } catch { }
                }
            }
        }

        static void HandleConnection(NetworkStream stream)
        {
            var req = ReadRequest(stream);
            if (req == null) return;

            switch (req.Path)
            {
                case "/api/ping":
                    SendJson(stream, 200, "{\"app\":\"ledger\",\"version\":1,\"rev\":" + rev + ",\"port\":" + port + "}");
                    return;

                case "/api/state":
                    HandleState(stream, req);
                    return;

                case "/api/backup":
                    if (req.Method != "POST") { SendText(stream, 405, "Method Not Allowed"); return; }
                    string name = NewBackup();
                    SendJson(stream, 200, "{\"file\":" + JsonString(name) + "}");
                    return;

                case "/api/info":
                    HandleInfo(stream);
                    return;

                case "/api/export.json":
                    Send(stream, 200, "application/json; charset=utf-8", Utf8.GetBytes(stateRaw),
                        "Content-Disposition: attachment; filename=\"ledger-backup-" + DateTime.Now.ToString("yyyy-MM-dd") + ".json\"\r\n");
                    return;

                case "/api/export.csv":
                    HandleCsv(stream, req);
                    return;
            }

            if (req.Method == "GET" || req.Method == "HEAD")
            {
                SendStatic(stream, req.Path);
                return;
            }
            SendText(stream, 405, "Method Not Allowed");
        }

        static void HandleState(NetworkStream stream, HttpRequest req)
        {
            if (req.Method == "GET")
            {
                SendJson(stream, 200, "{\"rev\":" + rev + ",\"data\":" + stateRaw + "}");
                return;
            }
            if (req.Method != "PUT")
            {
                SendText(stream, 405, "Method Not Allowed");
                return;
            }

            int clientRev = 0;
            string revHeader;
            if (req.Headers.TryGetValue("x-rev", out revHeader))
                int.TryParse(revHeader, NumberStyles.Integer, CultureInfo.InvariantCulture, out clientRev);

            lock (StateLock)
            {
                if (clientRev != rev)
                {
                    SendJson(stream, 409, "{\"error\":\"版本冲突\",\"rev\":" + rev + "}");
                    return;
                }
                if (!ValidateState(req.Body))
                {
                    SendJson(stream, 400, "{\"error\":\"数据结构不合法\"}");
                    return;
                }
                try
                {
                    EnsureDailyBackup();
                    SaveState(req.Body);
                    rev++;
                    SaveRev();
                    SendJson(stream, 200, "{\"rev\":" + rev + "}");
                }
                catch (Exception ex)
                {
                    SendJson(stream, 500, "{\"error\":" + JsonString(ex.Message) + "}");
                }
            }
        }

        static void HandleInfo(NetworkStream stream)
        {
            int count = 0;
            string last = "";
            try
            {
                var files = new List<FileInfo>(new DirectoryInfo(backupDir).GetFiles("ledger-*.json"));
                count = files.Count;
                if (count > 0)
                {
                    files.Sort((a, b) => b.LastWriteTime.CompareTo(a.LastWriteTime));
                    last = files[0].LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss");
                }
            }
            catch { }

            var sb = new StringBuilder();
            sb.Append("{");
            sb.Append("\"dataFile\":").Append(JsonString(dataFile)).Append(",");
            sb.Append("\"backupDir\":").Append(JsonString(backupDir)).Append(",");
            sb.Append("\"backupCount\":").Append(count).Append(",");
            sb.Append("\"lastBackup\":").Append(JsonString(last)).Append(",");
            sb.Append("\"rev\":").Append(rev);
            sb.Append("}");
            SendJson(stream, 200, sb.ToString());
        }

        // ======================= CSV =======================
        static void HandleCsv(NetworkStream stream, HttpRequest req)
        {
            var qs = ParseQuery(req.Query);
            bool all = qs.ContainsKey("all") && qs["all"] == "1";
            string month = qs.ContainsKey("month") ? qs["month"] : "";

            string csv = BuildCsv(month, all);
            byte[] body = Utf8.GetBytes(csv);
            byte[] bom = Encoding.UTF8.GetPreamble();
            byte[] payload = new byte[bom.Length + body.Length];
            Buffer.BlockCopy(bom, 0, payload, 0, bom.Length);
            Buffer.BlockCopy(body, 0, payload, bom.Length, body.Length);

            string fname = "ledger-" + DateTime.Now.ToString("yyyy-MM-dd") + ".csv";
            Send(stream, 200, "text/csv; charset=utf-8", payload,
                "Content-Disposition: attachment; filename=\"" + fname + "\"\r\n");
        }

        static string BuildCsv(string month, bool all)
        {
            Dictionary<string, object> root;
            try { root = Deserialize(stateRaw); }
            catch { return "日期,类型,金额,一级分类,二级分类,账户,标签,备注\r\n"; }

            var cats = new Dictionary<string, Dictionary<string, object>>();
            foreach (var c in Arr(Get(root, "categories")))
            {
                var cd = c as Dictionary<string, object>;
                if (cd != null) cats[Str(Get(cd, "id"))] = cd;
            }
            var accs = new Dictionary<string, Dictionary<string, object>>();
            foreach (var a in Arr(Get(root, "accounts")))
            {
                var ad = a as Dictionary<string, object>;
                if (ad != null) accs[Str(Get(ad, "id"))] = ad;
            }
            var tags = new Dictionary<string, Dictionary<string, object>>();
            foreach (var t in Arr(Get(root, "tags")))
            {
                var td = t as Dictionary<string, object>;
                if (td != null) tags[Str(Get(td, "id"))] = td;
            }

            var rows = new List<Dictionary<string, object>>();
            foreach (var t in Arr(Get(root, "transactions")))
            {
                var td = t as Dictionary<string, object>;
                if (td != null) rows.Add(td);
            }
            rows.Sort((a, b) =>
            {
                int c = string.CompareOrdinal(Str(Get(a, "date")), Str(Get(b, "date")));
                if (c != 0) return c;
                return string.CompareOrdinal(Str(Get(a, "createdAt")), Str(Get(b, "createdAt")));
            });

            var sb = new StringBuilder();
            sb.Append("日期,类型,金额,一级分类,二级分类,账户,标签,备注\r\n");

            foreach (var t in rows)
            {
                string date = Str(Get(t, "date"));
                if (!all && month.Length > 0 && !date.StartsWith(month, StringComparison.Ordinal)) continue;

                string kind = Str(Get(t, "kind"));
                string type = kind == "income" ? "收入" : kind == "transfer" ? "转账" : "支出";
                decimal amount = ToDecimal(Get(t, "amount")) / 100m;
                string amountText = amount.ToString("0.00", CultureInfo.InvariantCulture);

                string p1 = "", p2 = "";
                string cid = Str(Get(t, "categoryId"));
                if (cid.Length > 0 && cats.ContainsKey(cid))
                {
                    var cat = cats[cid];
                    string pid = Str(Get(cat, "parentId"));
                    if (pid.Length > 0 && cats.ContainsKey(pid))
                    {
                        p1 = Str(Get(cats[pid], "name"));
                        p2 = Str(Get(cat, "name"));
                    }
                    else p1 = Str(Get(cat, "name"));
                }

                string accName = "";
                string aid = Str(Get(t, "accountId"));
                if (aid.Length > 0 && accs.ContainsKey(aid)) accName = Str(Get(accs[aid], "name"));

                if (kind == "transfer")
                {
                    string toName = "";
                    string tid = Str(Get(t, "toAccountId"));
                    if (tid.Length > 0 && accs.ContainsKey(tid)) toName = Str(Get(accs[tid], "name"));
                    accName = accName + " → " + toName;
                    p1 = ""; p2 = "";
                }

                var tagNames = new List<string>();
                foreach (var tidObj in Arr(Get(t, "tagIds")))
                {
                    string tid = Str(tidObj);
                    if (tid.Length > 0 && tags.ContainsKey(tid)) tagNames.Add(Str(Get(tags[tid], "name")));
                }

                sb.Append(CsvCell(date)).Append(',');
                sb.Append(CsvCell(type)).Append(',');
                sb.Append(CsvCell(amountText)).Append(',');
                sb.Append(CsvCell(p1)).Append(',');
                sb.Append(CsvCell(p2)).Append(',');
                sb.Append(CsvCell(accName)).Append(',');
                sb.Append(CsvCell(string.Join("|", tagNames.ToArray()))).Append(',');
                sb.Append(CsvCell(Str(Get(t, "note"))));
                sb.Append("\r\n");
            }
            return sb.ToString();
        }

        static string CsvCell(string v)
        {
            if (v == null) v = "";
            if (v.IndexOfAny(new[] { '"', ',', '\r', '\n' }) >= 0)
                return "\"" + v.Replace("\"", "\"\"") + "\"";
            return v;
        }

        // ======================= 数据层 =======================
        static bool ValidateState(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return false;
            if (raw.IndexOf("\"version\"", StringComparison.Ordinal) < 0) return false;
            if (raw.IndexOf("\"accounts\"", StringComparison.Ordinal) < 0) return false;
            if (raw.IndexOf("\"categories\"", StringComparison.Ordinal) < 0) return false;
            if (raw.IndexOf("\"transactions\"", StringComparison.Ordinal) < 0) return false;
            try
            {
                var root = Deserialize(raw);
                return root != null
                    && IsArrayValue(Get(root, "accounts"))
                    && IsArrayValue(Get(root, "categories"))
                    && IsArrayValue(Get(root, "transactions"));
            }
            catch { return false; }
        }

        static Dictionary<string, object> Deserialize(string json)
        {
            var ser = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
            return ser.Deserialize<Dictionary<string, object>>(json);
        }

        static object Get(Dictionary<string, object> d, string key)
        {
            object v;
            return d != null && d.TryGetValue(key, out v) ? v : null;
        }

        static string Str(object o)
        {
            if (o == null) return "";
            return Convert.ToString(o, CultureInfo.InvariantCulture);
        }

        static decimal ToDecimal(object o)
        {
            if (o == null) return 0m;
            try { return Convert.ToDecimal(o, CultureInfo.InvariantCulture); }
            catch { return 0m; }
        }

        static bool IsArrayValue(object o)
        {
            if (o == null) return false;
            if (o is object[]) return true;
            return o is System.Collections.IList;
        }

        static IEnumerable<object> Arr(object o)
        {
            var a = o as object[];
            if (a != null) return a;
            var list = o as System.Collections.ArrayList;
            if (list != null) return list.ToArray();
            return new object[0];
        }

        static void InitData()
        {
            Directory.CreateDirectory(dataDir);
            Directory.CreateDirectory(backupDir);
            LoadRev();

            bool fresh = false;
            if (File.Exists(dataFile))
            {
                try
                {
                    string raw = File.ReadAllText(dataFile, Encoding.UTF8);
                    if (ValidateState(raw)) stateRaw = raw;
                    else if (RestoreFromBackup()) { }
                    else fresh = true;
                }
                catch { fresh = true; }
            }
            else fresh = true;

            if (fresh)
            {
                stateRaw = ReadResourceText(DefaultStateResource);
                SaveState(stateRaw);
                SaveRev();
            }

            NewBackup();
        }

        static bool RestoreFromBackup()
        {
            if (!Directory.Exists(backupDir)) return false;
            var files = new List<FileInfo>(new DirectoryInfo(backupDir).GetFiles("ledger-*.json"));
            files.Sort((a, b) => b.LastWriteTime.CompareTo(a.LastWriteTime));
            foreach (var f in files)
            {
                try
                {
                    string raw = File.ReadAllText(f.FullName, Encoding.UTF8);
                    if (ValidateState(raw))
                    {
                        SaveState(raw);
                        return true;
                    }
                }
                catch { }
            }
            return false;
        }

        static void SaveState(string raw)
        {
            string tmp = dataFile + ".tmp";
            File.WriteAllText(tmp, raw, Utf8);
            int attempt = 0;
            while (true)
            {
                try
                {
                    if (File.Exists(dataFile))
                    {
                        string bak = dataFile + ".bak";
                        File.Replace(tmp, dataFile, bak);
                        try { File.Delete(bak); } catch { }
                    }
                    else
                    {
                        File.Move(tmp, dataFile);
                    }
                    break;
                }
                catch
                {
                    attempt++;
                    if (attempt >= 3) throw;
                    Thread.Sleep(60);
                }
            }
            stateRaw = raw;
        }

        static void SaveRev()
        {
            Directory.CreateDirectory(dataDir);
            File.WriteAllText(metaFile, "{ \"rev\": " + rev + " }", Utf8);
        }

        static void LoadRev()
        {
            try
            {
                if (File.Exists(metaFile))
                {
                    var m = Deserialize(File.ReadAllText(metaFile, Encoding.UTF8));
                    rev = (int)ToDecimal(Get(m, "rev"));
                    if (rev < 1) rev = 1;
                }
            }
            catch { rev = 1; }
        }

        static string NewBackup()
        {
            if (!File.Exists(dataFile)) return "";
            Directory.CreateDirectory(backupDir);
            string stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            string name = "ledger-" + stamp + ".json";
            string dest = Path.Combine(backupDir, name);
            int i = 1;
            while (File.Exists(dest))
            {
                name = "ledger-" + stamp + "-" + i + ".json";
                dest = Path.Combine(backupDir, name);
                i++;
            }
            File.Copy(dataFile, dest, true);

            var files = new List<FileInfo>(new DirectoryInfo(backupDir).GetFiles("ledger-*.json"));
            files.Sort((a, b) => b.LastWriteTime.CompareTo(a.LastWriteTime));
            for (int k = 20; k < files.Count; k++)
            {
                try { files[k].Delete(); } catch { }
            }
            lastBackupDay = DateTime.Now.ToString("yyyy-MM-dd");
            return name;
        }

        static void EnsureDailyBackup()
        {
            string today = DateTime.Now.ToString("yyyy-MM-dd");
            if (lastBackupDay != today) NewBackup();
        }

        // ======================= HTTP 解析 =======================
        class HttpRequest
        {
            public string Method = "";
            public string Path = "";
            public string Query = "";
            public string Body = "";
            public Dictionary<string, string> Headers = new Dictionary<string, string>();
        }

        static int FindHeaderEnd(byte[] buf, int len)
        {
            for (int i = 0; i <= len - 4; i++)
            {
                if (buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10) return i;
            }
            return -1;
        }

        static HttpRequest ReadRequest(NetworkStream stream)
        {
            var ms = new MemoryStream();
            var buf = new byte[8192];
            int idx = -1;
            while (true)
            {
                int n;
                try { n = stream.Read(buf, 0, buf.Length); }
                catch { break; }
                if (n <= 0) break;
                ms.Write(buf, 0, n);
                idx = FindHeaderEnd(ms.GetBuffer(), (int)ms.Length);
                if (idx >= 0) break;
                if (ms.Length > 33 * 1024 * 1024) break;
            }
            if (ms.Length == 0) return null;

            byte[] all = ms.ToArray();
            idx = FindHeaderEnd(all, all.Length);
            if (idx < 0) return null;

            string headerText = Encoding.ASCII.GetString(all, 0, idx);
            string[] lines = headerText.Split(new[] { "\r\n" }, StringSplitOptions.None);
            string[] first = lines[0].Split(' ');
            if (first.Length < 3) return null;

            var req = new HttpRequest();
            req.Method = first[0].ToUpperInvariant();
            string target = first[1];
            int q = target.IndexOf('?');
            if (q >= 0)
            {
                req.Path = Uri.UnescapeDataString(target.Substring(0, q));
                req.Query = target.Substring(q + 1);
            }
            else req.Path = Uri.UnescapeDataString(target);

            for (int i = 1; i < lines.Length; i++)
            {
                int c = lines[i].IndexOf(':');
                if (c > 0)
                {
                    string k = lines[i].Substring(0, c).Trim().ToLowerInvariant();
                    string v = lines[i].Substring(c + 1).Trim();
                    req.Headers[k] = v;
                }
            }

            int contentLength = 0;
            string cl;
            if (req.Headers.TryGetValue("content-length", out cl))
                int.TryParse(cl, NumberStyles.Integer, CultureInfo.InvariantCulture, out contentLength);

            var bodyMs = new MemoryStream();
            int already = all.Length - (idx + 4);
            if (already > 0) bodyMs.Write(all, idx + 4, already);
            while (bodyMs.Length < contentLength)
            {
                int n = stream.Read(buf, 0, buf.Length);
                if (n <= 0) break;
                bodyMs.Write(buf, 0, n);
            }
            byte[] body = bodyMs.ToArray();
            if (body.Length > contentLength)
            {
                byte[] trimmed = new byte[contentLength];
                Buffer.BlockCopy(body, 0, trimmed, 0, contentLength);
                body = trimmed;
            }
            if (body.Length > 0) req.Body = Utf8.GetString(body);
            return req;
        }

        static Dictionary<string, string> ParseQuery(string query)
        {
            var result = new Dictionary<string, string>();
            if (string.IsNullOrEmpty(query)) return result;
            foreach (var pair in query.Split('&'))
            {
                if (pair.Length == 0) continue;
                int eq = pair.IndexOf('=');
                if (eq < 0) result[Uri.UnescapeDataString(pair)] = "";
                else result[Uri.UnescapeDataString(pair.Substring(0, eq))] = Uri.UnescapeDataString(pair.Substring(eq + 1));
            }
            return result;
        }

        static void Send(NetworkStream stream, int status, string contentType, byte[] body, string extraHeaders = "")
        {
            string reason = status == 200 ? "OK" : status == 400 ? "Bad Request"
                : status == 404 ? "Not Found" : status == 405 ? "Method Not Allowed"
                : status == 409 ? "Conflict" : status == 500 ? "Internal Server Error" : "OK";

            var sb = new StringBuilder();
            sb.Append("HTTP/1.1 ").Append(status).Append(' ').Append(reason).Append("\r\n");
            sb.Append("Content-Type: ").Append(contentType).Append("\r\n");
            sb.Append("Content-Length: ").Append(body.Length).Append("\r\n");
            sb.Append("Cache-Control: no-store\r\nConnection: close\r\n");
            if (!string.IsNullOrEmpty(extraHeaders)) sb.Append(extraHeaders);
            sb.Append("\r\n");

            byte[] head = Encoding.ASCII.GetBytes(sb.ToString());
            stream.Write(head, 0, head.Length);
            if (body.Length > 0) stream.Write(body, 0, body.Length);
            stream.Flush();
        }

        static void SendJson(NetworkStream stream, int status, string json)
        {
            Send(stream, status, "application/json; charset=utf-8", Utf8.GetBytes(json));
        }

        static void SendText(NetworkStream stream, int status, string text)
        {
            Send(stream, status, "text/plain; charset=utf-8", Utf8.GetBytes(text));
        }

        static void SendStatic(NetworkStream stream, string urlPath)
        {
            string path = urlPath == "/" || urlPath.Length == 0 ? "/index.html" : urlPath;
            if (path.IndexOf("..", StringComparison.Ordinal) >= 0 || path.IndexOf('\\') >= 0)
            {
                SendText(stream, 404, "404 Not Found");
                return;
            }

            string resource = AppResourcePrefix + path.TrimStart('/').Replace('/', '.');
            byte[] data = ReadResourceBytes(resource);
            if (data == null)
            {
                SendText(stream, 404, "404 Not Found");
                return;
            }
            Send(stream, 200, MimeFor(path), data);
        }

        static string MimeFor(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            switch (ext)
            {
                case ".html": return "text/html; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".js": return "text/javascript; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                case ".ico": return "image/x-icon";
                case ".woff2": return "font/woff2";
                case ".txt": return "text/plain; charset=utf-8";
                default: return "application/octet-stream";
            }
        }

        static byte[] ReadResourceBytes(string name)
        {
            var asm = Assembly.GetExecutingAssembly();
            using (var s = asm.GetManifestResourceStream(name))
            {
                if (s == null) return null;
                using (var ms = new MemoryStream())
                {
                    s.CopyTo(ms);
                    return ms.ToArray();
                }
            }
        }

        static string ReadResourceText(string name)
        {
            byte[] b = ReadResourceBytes(name);
            return b == null ? "" : Utf8.GetString(b);
        }

        static string JsonString(string s)
        {
            if (s == null) return "\"\"";
            var sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append("\"");
            return sb.ToString();
        }

        // ======================= 单实例 / 端口 =======================
        static string DataMutexName()
        {
            string key = Path.GetFullPath(dataDir).TrimEnd('\\').ToLowerInvariant();
            using (var md5 = MD5.Create())
            {
                byte[] hash = md5.ComputeHash(Encoding.UTF8.GetBytes(key));
                var sb = new StringBuilder("LedgerApp.");
                for (int i = 0; i < 8; i++) sb.Append(hash[i].ToString("x2"));
                return sb.ToString();
            }
        }

        static bool IsBindable(int p)
        {
            try
            {
                var probe = new TcpListener(IPAddress.Loopback, p);
                probe.Start();
                probe.Stop();
                return true;
            }
            catch { return false; }
        }

        static bool PingInstance(int p)
        {
            try
            {
                var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + p + "/api/ping");
                req.Proxy = null;          // 避免系统代理自动探测带来的延迟
                req.Timeout = 400;
                req.ReadWriteTimeout = 400;
                using (var resp = req.GetResponse())
                using (var sr = new StreamReader(resp.GetResponseStream()))
                {
                    return sr.ReadToEnd().Contains("\"app\":\"ledger\"");
                }
            }
            catch { return false; }
        }

        /// <summary>
        /// 找到已在运行的实例；否则返回第一个可绑定的端口。
        /// 先看端口能否绑定（瞬时），只有被占用时才发 HTTP 请求，避免启动时等待。
        /// </summary>
        static int FindExistingInstance(out int freePort)
        {
            freePort = 0;
            for (int p = startPort; p <= startPort + 9; p++)
            {
                if (IsBindable(p)) { freePort = p; return 0; }
                if (PingInstance(p)) return p;
            }
            return 0;
        }

        static int FindFreePort(int from, int to)
        {
            for (int p = from; p <= to; p++)
            {
                try
                {
                    var probe = new TcpListener(IPAddress.Loopback, p);
                    probe.Start();
                    probe.Stop();
                    return p;
                }
                catch { }
            }
            return 0;
        }

        static bool OpenBrowser(int p)
        {
            string url = "http://127.0.0.1:" + p + "/";
            try
            {
                System.Diagnostics.Process.Start(url);
                return true;
            }
            catch (Exception ex)
            {
                Log("打开浏览器失败（方式1）：" + ex.Message);
            }

            try
            {
                var psi = new System.Diagnostics.ProcessStartInfo("cmd.exe", "/c start \"\" \"" + url + "\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                System.Diagnostics.Process.Start(psi);
                return true;
            }
            catch (Exception ex)
            {
                Log("打开浏览器失败（方式2）：" + ex.Message);
            }

            try
            {
                System.Diagnostics.Process.Start("rundll32.exe", "url.dll,FileProtocolHandler " + url);
                return true;
            }
            catch (Exception ex)
            {
                Log("打开浏览器失败（方式3）：" + ex.Message);
            }

            // 方式4：从注册表读出默认浏览器的 exe，直接带参数启动（绕过 ShellExecute）
            try
            {
                string browser = FindDefaultBrowserExe();
                if (!string.IsNullOrEmpty(browser))
                {
                    var psi = new System.Diagnostics.ProcessStartInfo(browser, "\"" + url + "\"");
                    psi.UseShellExecute = false;
                    System.Diagnostics.Process.Start(psi);
                    return true;
                }
                Log("没有从注册表找到默认浏览器");
            }
            catch (Exception ex)
            {
                Log("打开浏览器失败（方式4）：" + ex.Message);
            }
            return false;
        }

        static string FindDefaultBrowserExe()
        {
            string progId = null;
            using (var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice"))
            {
                if (key != null) progId = key.GetValue("ProgId") as string;
            }
            if (string.IsNullOrEmpty(progId))
            {
                using (var key = Microsoft.Win32.Registry.ClassesRoot.OpenSubKey(
                    @"http\shell\open\command"))
                {
                    if (key != null) return ExtractExePath(key.GetValue("") as string);
                }
                return null;
            }
            using (var key = Microsoft.Win32.Registry.ClassesRoot.OpenSubKey(
                progId + @"\shell\open\command"))
            {
                if (key == null) return null;
                return ExtractExePath(key.GetValue("") as string);
            }
        }

        static string ExtractExePath(string command)
        {
            if (string.IsNullOrEmpty(command)) return null;
            command = command.Trim();
            if (command.StartsWith("\""))
            {
                int end = command.IndexOf('"', 1);
                if (end > 1) return command.Substring(1, end - 1);
            }
            int space = command.IndexOf(' ');
            return space > 0 ? command.Substring(0, space) : command;
        }

        static void Log(string message)
        {
            try
            {
                Directory.CreateDirectory(dataDir);
                File.AppendAllText(Path.Combine(dataDir, "app.log"),
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + "\r\n", Utf8);
            }
            catch { }
        }

        // ======================= 窗口 =======================
        static void RunWindow()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            var form = new Form();
            form.Text = "记账本";
            form.ClientSize = new Size(400, 216);
            form.FormBorderStyle = FormBorderStyle.FixedSingle;
            form.MaximizeBox = false;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.BackColor = Color.White;

            var title = new Label();
            title.Text = "记账本";
            title.Font = new Font("Microsoft YaHei UI", 16F, FontStyle.Bold);
            title.Location = new Point(24, 18);
            title.AutoSize = true;

            var status = new Label();
            status.Text = "服务运行中  ·  http://127.0.0.1:" + port + "/";
            status.Location = new Point(24, 62);
            status.AutoSize = true;
            status.ForeColor = Color.FromArgb(75, 85, 99);

            string url = "http://127.0.0.1:" + port + "/";

            var link = new LinkLabel();
            link.Text = url;
            link.Location = new Point(24, 88);
            link.AutoSize = true;
            link.Font = new Font("Microsoft YaHei UI", 9F);
            link.Click += delegate { OpenBrowser(port); };

            var hint = new Label();
            hint.Text = "关闭此窗口即停止服务；数据保存在 data 文件夹\r\n如果浏览器没自动打开，点上面的地址，或复制到浏览器里";
            hint.Location = new Point(24, 110);
            hint.AutoSize = true;
            hint.ForeColor = Color.FromArgb(138, 148, 166);
            hint.Font = new Font("Microsoft YaHei UI", 8F);

            var open = new Button();
            open.Text = "打开记账页面";
            open.Location = new Point(24, 160);
            open.Size = new Size(150, 34);
            open.Click += delegate
            {
                if (!OpenBrowser(port))
                {
                    MessageBox.Show("无法自动打开浏览器，请手动访问：\r\n" + url, "记账本",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            };

            var copy = new Button();
            copy.Text = "复制地址";
            copy.Location = new Point(184, 160);
            copy.Size = new Size(96, 34);
            copy.Click += delegate
            {
                try
                {
                    Clipboard.SetText(url);
                    MessageBox.Show("地址已复制，粘贴到浏览器即可打开。", "记账本",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
                catch { }
            };

            var quit = new Button();
            quit.Text = "退出";
            quit.Location = new Point(290, 160);
            quit.Size = new Size(80, 34);
            quit.Click += delegate { form.Close(); };

            form.Controls.Add(title);
            form.Controls.Add(status);
            form.Controls.Add(link);
            form.Controls.Add(hint);
            form.Controls.Add(open);
            form.Controls.Add(copy);
            form.Controls.Add(quit);

            form.FormClosed += delegate
            {
                stopping = true;
                try { listener.Stop(); } catch { }
                Application.Exit();
            };

            Application.Run(form);
        }
    }
}
