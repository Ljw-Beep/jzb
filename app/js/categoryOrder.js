// 分类排序与层级调整（纯函数，方便测试）
// 说明：分类只有两级；同一父级下用 order 决定顺序。

function siblingsOf(categories, kind, parentId) {
  return categories
    .filter((c) => c.kind === kind && (c.parentId || null) === (parentId || null))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}

function resequence(list) {
  const base = list.length ? Math.min(...list.map((c) => c.order || 0)) : 1;
  list.forEach((c, i) => { c.order = base + i; });
}

/**
 * 在同一父级内把 dragId 移动到 targetId 前面或后面。
 * 跨父级或跨类型时不做任何事。
 */
export function reorderWithinSiblings(categories, dragId, targetId, placeAfter = false) {
  if (!dragId || !targetId || dragId === targetId) return categories;
  const cats = categories.map((c) => ({ ...c }));
  const drag = cats.find((c) => c.id === dragId);
  const target = cats.find((c) => c.id === targetId);
  if (!drag || !target) return categories;
  if (drag.kind !== target.kind) return categories;
  if ((drag.parentId || null) !== (target.parentId || null)) return categories;

  const group = siblingsOf(cats, drag.kind, drag.parentId).filter((c) => c.id !== dragId);
  let idx = group.findIndex((c) => c.id === targetId);
  if (idx < 0) return categories;
  if (placeAfter) idx += 1;
  group.splice(idx, 0, drag);
  resequence(group);
  return cats;
}

/**
 * 把子分类移动到另一个一级分类下（或移动到顶级：newParentId 传 null）。
 * 只允许两级：目标必须是一级分类。
 */
export function moveToParent(categories, childId, newParentId) {
  const cats = categories.map((c) => ({ ...c }));
  const child = cats.find((c) => c.id === childId);
  if (!child) return categories;
  if (child.id === newParentId) return categories;

  if (newParentId) {
    const parent = cats.find((c) => c.id === newParentId);
    if (!parent || parent.parentId) return categories;
    if (parent.kind !== child.kind) return categories;
  }

  child.parentId = newParentId || null;
  const group = siblingsOf(cats, child.kind, newParentId).filter((c) => c.id !== childId);
  child.order = group.length ? Math.max(...group.map((c) => c.order || 0)) + 1 : 1;
  return cats;
}

/** 一级分类之间排序。 */
export function reorderTopLevel(categories, dragId, targetId, placeAfter = false) {
  return reorderWithinSiblings(categories, dragId, targetId, placeAfter);
}
