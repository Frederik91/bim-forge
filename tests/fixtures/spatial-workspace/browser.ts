import type { Page } from 'playwright';

/** Follow the visible menu path before activating a secondary conversation action. */
export async function clickConversationControl(page: Page, selector: string): Promise<void> {
  const control = page.locator(selector);
  if (!await control.isVisible()) await page.locator('#spatial-chat-options-toggle').click();
  await control.click();
}
