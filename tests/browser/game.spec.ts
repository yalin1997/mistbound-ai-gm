import { test, expect, type Page } from "@playwright/test";
import type { RoomView } from "../../shared/types";

async function state(page: Page) {
  const id = /room\/([^/]+)/.exec(page.url())![1];
  return (
    await page.request.get(`/api/rooms/${id}`)
  ).json() as Promise<RoomView>;
}
async function register(page: Page, suffix: string) {
  await page.goto("/");
  await page.getByLabel("旅人名稱").fill(`旅人${suffix}`);
  await page.getByLabel("密碼", { exact: true }).fill("test-password-42");
  await page.getByRole("button", { name: "建立帳號，開始冒險" }).click();
  await expect(
    page.getByRole("heading", { name: "霧散之前，啟程。" }),
  ).toBeVisible();
}
async function build(page: Page, name: string) {
  await page.getByLabel("角色名字").fill(name);
  await page.getByRole("button", { name: "完成角色建立" }).click();
  await expect(page.getByRole("button", { name: "我準備好了" })).toBeEnabled();
  await page.getByRole("button", { name: "我準備好了" }).click();
  await expect(page.getByRole("button", { name: "取消準備" })).toBeVisible();
}
async function checkedAction(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
  await expect(page.getByRole("button", { name: "擲出 D20" })).toBeEnabled();
  await page.getByRole("button", { name: "擲出 D20" }).click();
  await expect(page.getByRole("button", { name: "擲出 D20" })).toHaveCount(0);
}
async function until(
  page: Page,
  predicate: (r: RoomView) => boolean,
  action: string,
) {
  for (let i = 0; i < 20; i++) {
    const r = await state(page);
    if (predicate(r)) return;
    if (r.members[0].character!.hp < 6 && r.members[0].character!.potions > 0) {
      await page.getByRole("button", { name: "使用藥水", exact: true }).click();
    }
    await checkedAction(page, action);
  }
  throw new Error(`Could not satisfy ${action}`);
}

test("single device: create hero, complete a real-dice adventure, resume and continue; desktop/tablet/mobile layouts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await register(page, `${Date.now()}`);
  await page.screenshot({
    path: "test-results/home-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "單人啟程" }).click();
  await build(page, "暮潮行者");
  await page.getByRole("button", { name: "開始冒險" }).click();
  await expect(
    page.getByRole("heading", { name: "重燃霧海之燈" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/game-desktop.png",
    fullPage: true,
  });
  await until(page, (r) => r.session!.clues >= 1, "交談");
  await page.getByRole("button", { name: "低語濕地" }).click();
  await expect
    .poll(async () => (await state(page)).session!.scene)
    .toBe("marsh");
  await until(page, (r) => r.session!.clues >= 2, "觀察四周");
  await page.reload();
  await expect(page.getByRole("heading", { name: "低語濕地" })).toBeVisible();
  await page.getByRole("button", { name: "無光燈塔" }).click();
  await until(page, (r) => r.session!.objectiveReady, "交談");
  await until(page, (r) => r.phase === "won", "調查／操作");
  await page.getByRole("button", { name: "接續第二章" }).click();
  await expect(
    page.getByRole("heading", { name: "守燈人的回聲" }),
  ).toBeVisible();
  expect((await state(page)).members[0].character!.level).toBe(2);
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.screenshot({
    path: "test-results/game-tablet.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/game-mobile-story.png",
    fullPage: true,
  });
  await expect(page.getByRole("button", { name: "故事與行動" })).toBeVisible();
  await page.getByRole("button", { name: "場景地圖" }).click();
  await expect(page.getByRole("heading", { name: "暮潮港" })).toBeVisible();
  await page.getByRole("button", { name: "角色背包" }).click();
  await expect(page.getByRole("heading", { name: "暮潮行者" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("four independent browsers: invitation, character ownership, shared turns, unanimous travel, chat, disconnection and reconnect", async ({
  browser,
}) => {
  const contexts = await Promise.all(
    [0, 1, 2, 3].map(() =>
      browser.newContext({ viewport: { width: 1280, height: 900 } }),
    ),
  );
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  const stamp = Date.now();
  try {
    for (let i = 0; i < 4; i++) await register(pages[i], `${stamp}${i}`);
    await pages[0].getByRole("button", { name: "建立合作房間" }).click();
    await expect(
      pages[0].getByRole("heading", { name: "在出發之前" }),
    ).toBeVisible();
    const url = pages[0].url();
    for (let i = 1; i < 4; i++) {
      await pages[i].goto(url);
      await expect(
        pages[i].getByRole("heading", { name: "在出發之前" }),
      ).toBeVisible();
    }
    for (let i = 0; i < 4; i++) await build(pages[i], `同行者${i}`);
    await expect(
      pages[0].getByRole("button", { name: "開始冒險" }),
    ).toBeEnabled();
    await pages[0].getByRole("button", { name: "開始冒險" }).click();
    for (const page of pages)
      await expect(
        page.getByRole("heading", { name: "重燃霧海之燈" }),
      ).toBeVisible();
    await expect(
      pages[1].getByRole("button", { name: "觀察四周", exact: true }),
    ).toBeDisabled();
    await checkedAction(pages[0], "觀察四周");
    await expect(
      pages[1].getByRole("button", { name: "觀察四周", exact: true }),
    ).toBeEnabled();
    await pages[1].getByRole("button", { name: "低語濕地" }).click();
    for (const i of [0, 2, 3]) {
      await expect(
        pages[i].getByRole("button", { name: "同意移動" }),
      ).toBeEnabled();
      await pages[i].getByRole("button", { name: "同意移動" }).click();
    }
    for (const page of pages)
      await expect(
        page.getByRole("heading", { name: "低語濕地" }),
      ).toBeVisible();
    await pages[2].getByLabel("聊天訊息").fill("一起尋找刻文");
    await pages[2].getByRole("button", { name: "送出訊息" }).click();
    await expect(
      pages[3].getByText("一起尋找刻文", { exact: false }),
    ).toBeVisible();
    const before = await state(pages[0]);
    const expectedActor =
      before.session!.turnOrder[(before.session!.turnIndex + 1) % 4];
    await pages[2].goto("about:blank");
    await expect
      .poll(async () => (await state(pages[0])).activeActorId)
      .toBe(expectedActor);
    await pages[2].goto(url);
    await expect(
      pages[2].getByRole("heading", { name: "低語濕地" }),
    ).toBeVisible();
    const versions = await Promise.all(pages.map(state));
    expect(new Set(versions.map((v) => v.revision)).size).toBe(1);
    expect(versions[0].presence.every((p) => p.online)).toBe(true);
  } finally {
    for (const c of contexts) await c.close();
  }
});
