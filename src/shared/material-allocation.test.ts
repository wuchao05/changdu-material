import assert from "node:assert/strict";
import {
  allocateMaterialCountsByPercent,
  calculateAllocationSummary,
  distributeRemainingByWeight,
  distributeRemainingEvenly,
  getRowAvailableIncrease,
  getRowMaxSettablePercent,
  normalizeUnlockedAllocation,
  setAllocationPercent,
  type MaterialAllocationItem,
} from "./material-allocation";

interface TestItem extends MaterialAllocationItem {
  name: string;
}

function createItem(
  id: string,
  percent: number,
  maxPercent: number,
  locked = false,
  weight = 1,
  order = 1,
): TestItem {
  return {
    id,
    name: id,
    percent,
    maxPercent,
    locked,
    weight,
    order,
  };
}

function runTests() {
  const summary = calculateAllocationSummary([
    createItem("A", 34, 48, true, 1, 1),
    createItem("B", 45, 59, false, 2, 2),
    createItem("C", 7, 21, false, 1, 3),
  ]);
  assert.equal(summary.totalPercent, 86);
  assert.equal(summary.remainingPercent, 14);
  assert.equal(summary.status, "under");

  const baseItems = [
    createItem("A", 34, 48, true, 1, 1),
    createItem("B", 45, 59, false, 2, 2),
    createItem("C", 7, 21, false, 1, 3),
  ];
  assert.equal(getRowMaxSettablePercent(baseItems, "B"), 59);
  assert.equal(getRowAvailableIncrease(baseItems, "B"), 14);

  const adjusted = setAllocationPercent(baseItems, "B", 60);
  assert.equal(adjusted.items.find((item) => item.id === "B")?.percent, 59);

  const averageResult = distributeRemainingEvenly(baseItems);
  assert.deepEqual(
    averageResult.items.map((item) => item.percent),
    [34, 52, 14],
  );

  const weightedResult = distributeRemainingByWeight([
    createItem("A", 20, 70, false, 3, 1),
    createItem("B", 10, 50, false, 1, 2),
    createItem("C", 10, 50, false, 0, 3),
  ]);
  assert.deepEqual(
    weightedResult.items.map((item) => item.percent),
    [65, 25, 10],
  );

  const weightZeroResult = distributeRemainingByWeight([
    createItem("A", 20, 80, false, 0, 1),
    createItem("B", 20, 80, false, 0, 2),
  ]);
  assert.equal(weightZeroResult.changed, false);
  assert.match(weightZeroResult.message, /权重为 0/);

  const normalizedResult = normalizeUnlockedAllocation([
    createItem("A", 40, 60, true, 1, 1),
    createItem("B", 30, 80, false, 1, 2),
    createItem("C", 10, 40, false, 1, 3),
  ]);
  assert.equal(
    normalizedResult.items.reduce((sum, item) => sum + item.percent, 0),
    100,
  );
  assert.equal(normalizedResult.items[0].percent, 40);

  const normalizedZeroBase = normalizeUnlockedAllocation([
    createItem("A", 30, 30, true, 1, 1),
    createItem("B", 0, 40, false, 1, 2),
    createItem("C", 0, 40, false, 1, 3),
  ]);
  assert.equal(
    normalizedZeroBase.items.reduce((sum, item) => sum + item.percent, 0),
    100,
  );

  const countResult = allocateMaterialCountsByPercent(8, [
    createItem("A", 50, 100, false, 1, 1),
    createItem("B", 25, 100, false, 1, 2),
    createItem("C", 25, 100, false, 1, 3),
  ]);
  assert.deepEqual(countResult, [
    { id: "A", count: 4 },
    { id: "B", count: 2 },
    { id: "C", count: 2 },
  ]);

  const partialCountResult = allocateMaterialCountsByPercent(8, [
    createItem("A", 20, 100, false, 1, 1),
    createItem("B", 20, 100, false, 1, 2),
  ]);
  assert.deepEqual(partialCountResult, [
    { id: "A", count: 2 },
    { id: "B", count: 1 },
  ]);

  const cappedAverage = distributeRemainingEvenly([
    createItem("A", 50, 50, false, 1, 1),
    createItem("B", 20, 25, false, 1, 2),
    createItem("C", 10, 80, false, 1, 3),
  ]);
  assert.deepEqual(
    cappedAverage.items.map((item) => item.percent),
    [50, 25, 25],
  );

  console.log("material-allocation tests passed");
}

runTests();
