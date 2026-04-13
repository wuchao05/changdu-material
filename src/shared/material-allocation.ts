export interface MaterialAllocationItem {
  id: string;
  percent: number;
  maxPercent: number;
  locked: boolean;
  weight: number;
  order: number;
}

export interface MaterialAllocationSummary {
  totalPercent: number;
  remainingPercent: number;
  status: "under" | "full" | "over";
  autoAllocatableCount: number;
  hasInvalidRow: boolean;
}

export interface MaterialAllocationMutationResult<
  T extends MaterialAllocationItem,
> {
  items: T[];
  changed: boolean;
  message: string;
}

interface WeightedAllocationCandidate {
  id: string;
  weight: number;
  cap: number;
  order: number;
}

function cloneItems<T extends MaterialAllocationItem>(items: T[]): T[] {
  return items.map((item) => ({ ...item }));
}

function sortByOrder<T extends { order: number }>(items: T[]): T[] {
  return [...items].sort((left, right) => left.order - right.order);
}

export function normalizeAllocationPercent(value: unknown): number {
  return Math.max(0, Math.min(100, Math.round(Number(value ?? 0))));
}

export function normalizeAllocationMaxPercent(value: unknown): number {
  return Math.max(0, Math.min(100, Math.round(Number(value ?? 100))));
}

export function normalizeAllocationWeight(value: unknown): number {
  return Math.max(0, Math.round(Number(value ?? 1)));
}

export function normalizeAllocationOrder(
  value: unknown,
  fallbackOrder: number,
): number {
  const nextValue = Math.round(Number(value ?? fallbackOrder));
  return Number.isFinite(nextValue) && nextValue > 0
    ? nextValue
    : fallbackOrder;
}

export function buildEqualPercentages(count: number): number[] {
  if (count <= 0) {
    return [];
  }

  const base = Math.floor(100 / count);
  const remainder = 100 - base * count;
  return Array.from(
    { length: count },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
}

export function calculateAllocationSummary<T extends MaterialAllocationItem>(
  items: T[],
): MaterialAllocationSummary {
  const totalPercent = items.reduce(
    (sum, item) => sum + normalizeAllocationPercent(item.percent),
    0,
  );
  const remainingPercent = 100 - totalPercent;
  const status =
    totalPercent < 100 ? "under" : totalPercent === 100 ? "full" : "over";

  return {
    totalPercent,
    remainingPercent,
    status,
    autoAllocatableCount: items.filter(
      (item) => !item.locked && getRowAvailableIncrease(items, item.id) > 0,
    ).length,
    hasInvalidRow: items.some((item) => {
      const percent = Math.round(Number(item.percent ?? 0));
      const maxPercent = Math.round(Number(item.maxPercent ?? 100));
      const weight = Math.round(Number(item.weight ?? 0));
      return (
        !Number.isFinite(percent) ||
        !Number.isFinite(maxPercent) ||
        !Number.isFinite(weight) ||
        percent < 0 ||
        percent > 100 ||
        maxPercent < 0 ||
        maxPercent > 100 ||
        weight < 0 ||
        percent > maxPercent
      );
    }),
  };
}

export function getRowMaxSettablePercent<T extends MaterialAllocationItem>(
  items: T[],
  itemId: string,
): number {
  const currentItem = items.find((item) => item.id === itemId);
  if (!currentItem) {
    return 0;
  }

  const totalOtherPercent = items.reduce((sum, item) => {
    if (item.id === itemId) {
      return sum;
    }
    return sum + normalizeAllocationPercent(item.percent);
  }, 0);

  return Math.max(
    0,
    Math.min(
      normalizeAllocationMaxPercent(currentItem.maxPercent),
      100 - totalOtherPercent,
    ),
  );
}

export function getRowAvailableIncrease<T extends MaterialAllocationItem>(
  items: T[],
  itemId: string,
): number {
  const currentItem = items.find((item) => item.id === itemId);
  if (!currentItem) {
    return 0;
  }

  return Math.max(
    0,
    getRowMaxSettablePercent(items, itemId) -
      normalizeAllocationPercent(currentItem.percent),
  );
}

export function setAllocationPercent<T extends MaterialAllocationItem>(
  items: T[],
  itemId: string,
  nextPercent: number,
): MaterialAllocationMutationResult<T> {
  const nextItems = cloneItems(items);
  const targetIndex = nextItems.findIndex((item) => item.id === itemId);
  if (targetIndex < 0) {
    return { items: nextItems, changed: false, message: "未找到对应账号" };
  }

  const requestedValue = normalizeAllocationPercent(nextPercent);
  const maxSettablePercent = getRowMaxSettablePercent(nextItems, itemId);
  const appliedValue = Math.min(requestedValue, maxSettablePercent);
  const currentValue = normalizeAllocationPercent(
    nextItems[targetIndex].percent,
  );
  nextItems[targetIndex].percent = appliedValue;

  const changed = currentValue !== appliedValue;
  const message =
    requestedValue !== appliedValue
      ? `已自动调整为最大可用值 ${appliedValue}%`
      : changed
        ? `已更新为 ${appliedValue}%`
        : "当前比例未变化";

  return {
    items: nextItems,
    changed,
    message,
  };
}

function allocateByWeight(
  totalUnits: number,
  candidates: WeightedAllocationCandidate[],
  fallbackToEqualWeight: boolean,
): { allocations: Map<string, number>; leftover: number } {
  const allocations = new Map<string, number>();
  const normalizedCandidates = sortByOrder(candidates)
    .map((candidate) => ({
      ...candidate,
      cap: Math.max(0, Math.round(candidate.cap)),
      weight: Math.max(0, Math.round(candidate.weight)),
    }))
    .filter((candidate) => candidate.cap > 0);

  normalizedCandidates.forEach((candidate) => {
    allocations.set(candidate.id, 0);
  });

  let remaining = Math.max(0, Math.round(totalUnits));
  while (remaining > 0) {
    const activeCandidates = normalizedCandidates.filter((candidate) => {
      const allocated = allocations.get(candidate.id) || 0;
      return allocated < candidate.cap;
    });

    if (!activeCandidates.length) {
      break;
    }

    const positiveWeightCandidates = activeCandidates.filter(
      (candidate) => candidate.weight > 0,
    );

    if (!positiveWeightCandidates.length && !fallbackToEqualWeight) {
      break;
    }

    const workingCandidates =
      positiveWeightCandidates.length > 0
        ? positiveWeightCandidates
        : activeCandidates.map((candidate) => ({ ...candidate, weight: 1 }));

    const totalWeight = workingCandidates.reduce(
      (sum, candidate) => sum + candidate.weight,
      0,
    );
    if (totalWeight <= 0) {
      break;
    }

    const roundCandidates = workingCandidates.map((candidate) => {
      const allocated = allocations.get(candidate.id) || 0;
      const capacity = candidate.cap - allocated;
      const rawShare = (remaining * candidate.weight) / totalWeight;
      const baseShare = Math.min(capacity, Math.floor(rawShare));
      return {
        ...candidate,
        capacity,
        baseShare,
        remainder: rawShare - Math.floor(rawShare),
      };
    });

    let assignedThisRound = 0;
    roundCandidates.forEach((candidate) => {
      if (candidate.baseShare <= 0) {
        return;
      }
      allocations.set(
        candidate.id,
        (allocations.get(candidate.id) || 0) + candidate.baseShare,
      );
      assignedThisRound += candidate.baseShare;
    });
    remaining -= assignedThisRound;

    if (remaining <= 0) {
      break;
    }

    const extraCandidates = roundCandidates
      .filter((candidate) => {
        const allocated = allocations.get(candidate.id) || 0;
        return allocated < candidate.cap;
      })
      .sort((left, right) => {
        if (right.remainder !== left.remainder) {
          return right.remainder - left.remainder;
        }
        if (right.weight !== left.weight) {
          return right.weight - left.weight;
        }
        return left.order - right.order;
      });

    if (!extraCandidates.length) {
      break;
    }

    for (const candidate of extraCandidates) {
      if (remaining <= 0) {
        break;
      }
      const allocated = allocations.get(candidate.id) || 0;
      if (allocated >= candidate.cap) {
        continue;
      }
      allocations.set(candidate.id, allocated + 1);
      remaining -= 1;
    }
  }

  return {
    allocations,
    leftover: remaining,
  };
}

function mergeAllocatedPercents<T extends MaterialAllocationItem>(
  items: T[],
  allocations: Map<string, number>,
): T[] {
  return items.map((item) => {
    if (!allocations.has(item.id)) {
      return { ...item };
    }
    return {
      ...item,
      percent: allocations.get(item.id) || 0,
    };
  });
}

export function distributeRemainingEvenly<T extends MaterialAllocationItem>(
  items: T[],
): MaterialAllocationMutationResult<T> {
  const summary = calculateAllocationSummary(items);
  if (summary.remainingPercent <= 0) {
    return {
      items: cloneItems(items),
      changed: false,
      message: "当前没有剩余比例可分配",
    };
  }

  const candidates = items
    .filter(
      (item) => !item.locked && getRowAvailableIncrease(items, item.id) > 0,
    )
    .map((item) => ({
      id: item.id,
      weight: 1,
      cap:
        normalizeAllocationPercent(item.percent) +
        getRowAvailableIncrease(items, item.id),
      order: item.order,
    }));

  if (!candidates.length) {
    return {
      items: cloneItems(items),
      changed: false,
      message: "当前没有可参与平均分配的账号",
    };
  }

  const baseAllocations = new Map<string, number>();
  items.forEach((item) => {
    baseAllocations.set(item.id, normalizeAllocationPercent(item.percent));
  });

  const { allocations } = allocateByWeight(
    summary.remainingPercent,
    candidates.map((candidate) => ({
      ...candidate,
      cap: candidate.cap - (baseAllocations.get(candidate.id) || 0),
    })),
    true,
  );

  allocations.forEach((added, id) => {
    baseAllocations.set(id, (baseAllocations.get(id) || 0) + added);
  });

  return {
    items: mergeAllocatedPercents(items, baseAllocations),
    changed: allocations.size > 0,
    message: "已完成平均分配剩余",
  };
}

export function distributeRemainingByWeight<T extends MaterialAllocationItem>(
  items: T[],
): MaterialAllocationMutationResult<T> {
  const summary = calculateAllocationSummary(items);
  if (summary.remainingPercent <= 0) {
    return {
      items: cloneItems(items),
      changed: false,
      message: "当前没有剩余比例可分配",
    };
  }

  const candidates = items
    .filter(
      (item) => !item.locked && getRowAvailableIncrease(items, item.id) > 0,
    )
    .map((item) => ({
      id: item.id,
      weight: normalizeAllocationWeight(item.weight),
      cap:
        normalizeAllocationPercent(item.percent) +
        getRowAvailableIncrease(items, item.id),
      order: item.order,
    }));

  if (!candidates.length) {
    return {
      items: cloneItems(items),
      changed: false,
      message: "当前没有可参与按权重补足的账号",
    };
  }

  if (!candidates.some((candidate) => candidate.weight > 0)) {
    return {
      items: cloneItems(items),
      changed: false,
      message: "所有可参与账号权重为 0，无法按权重补足",
    };
  }

  const baseAllocations = new Map<string, number>();
  items.forEach((item) => {
    baseAllocations.set(item.id, normalizeAllocationPercent(item.percent));
  });

  const { allocations } = allocateByWeight(
    summary.remainingPercent,
    candidates.map((candidate) => ({
      ...candidate,
      cap: candidate.cap - (baseAllocations.get(candidate.id) || 0),
    })),
    false,
  );

  allocations.forEach((added, id) => {
    baseAllocations.set(id, (baseAllocations.get(id) || 0) + added);
  });

  return {
    items: mergeAllocatedPercents(items, baseAllocations),
    changed: allocations.size > 0,
    message: "已按权重补足剩余比例",
  };
}

export function normalizeUnlockedAllocation<T extends MaterialAllocationItem>(
  items: T[],
): MaterialAllocationMutationResult<T> {
  const summary = calculateAllocationSummary(items);
  if (summary.totalPercent === 100) {
    return {
      items: cloneItems(items),
      changed: false,
      message: "当前总和已是 100%",
    };
  }

  const lockedItems = items.filter((item) => item.locked);
  const unlockedItems = items.filter((item) => !item.locked);
  if (!unlockedItems.length) {
    return {
      items: cloneItems(items),
      changed: false,
      message: "当前没有可参与归一化的账号",
    };
  }

  const lockedTotal = lockedItems.reduce(
    (sum, item) => sum + normalizeAllocationPercent(item.percent),
    0,
  );
  if (lockedTotal > 100) {
    return {
      items: cloneItems(items),
      changed: false,
      message: "锁定项合计已超过 100%，请先调整后再归一化",
    };
  }

  const targetUnlockedTotal = 100 - lockedTotal;
  const unlockedCurrentTotal = unlockedItems.reduce(
    (sum, item) => sum + normalizeAllocationPercent(item.percent),
    0,
  );
  const totalCap = unlockedItems.reduce(
    (sum, item) => sum + normalizeAllocationMaxPercent(item.maxPercent),
    0,
  );
  const safeTarget = Math.max(0, Math.min(targetUnlockedTotal, totalCap));
  const useEqualWeight = unlockedCurrentTotal <= 0;

  const { allocations, leftover } = allocateByWeight(
    safeTarget,
    unlockedItems.map((item) => ({
      id: item.id,
      weight: useEqualWeight ? 1 : normalizeAllocationPercent(item.percent),
      cap: normalizeAllocationMaxPercent(item.maxPercent),
      order: item.order,
    })),
    true,
  );

  const nextItems = items.map((item) => {
    if (item.locked) {
      return { ...item };
    }
    return {
      ...item,
      percent: allocations.get(item.id) || 0,
    };
  });

  return {
    items: nextItems,
    changed: true,
    message:
      leftover > 0
        ? `已归一化到最接近 100% 的结果，仍有 ${leftover}% 无法继续分配`
        : "已归一化到 100%",
  };
}

export function allocateMaterialCountsByPercent<
  T extends Pick<MaterialAllocationItem, "id" | "percent" | "order">,
>(
  totalMaterialCount: number,
  items: T[],
): Array<{ id: string; count: number }> {
  const safeTotalMaterialCount = Math.max(0, Math.round(totalMaterialCount));
  if (safeTotalMaterialCount <= 0 || items.length === 0) {
    return [];
  }

  const sortedItems = sortByOrder(items).filter(
    (item) => normalizeAllocationPercent(item.percent) > 0,
  );
  if (!sortedItems.length) {
    return [];
  }

  const totalPercent = sortedItems.reduce(
    (sum, item) => sum + normalizeAllocationPercent(item.percent),
    0,
  );
  if (totalPercent <= 0) {
    return [];
  }

  const targetMaterialCount = Math.min(
    safeTotalMaterialCount,
    Math.round((safeTotalMaterialCount * Math.min(totalPercent, 100)) / 100),
  );

  const { allocations } = allocateByWeight(
    targetMaterialCount,
    sortedItems.map((item) => ({
      id: item.id,
      weight: normalizeAllocationPercent(item.percent),
      cap: safeTotalMaterialCount,
      order: item.order,
    })),
    true,
  );

  return sortedItems.map((item) => ({
    id: item.id,
    count: allocations.get(item.id) || 0,
  }));
}
