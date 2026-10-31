import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';
import type { ConversationMessage } from '../src/request-conversation.ts';
import type { RequestChat, RequestChatInput } from './request-chat.ts';
import type { RequestChatDecision, RequestChatProposalReview } from './request-chat-status.ts';

declare global {
  interface Window {
    requestChatModule: typeof import('./request-chat.ts');
    chatTest: {
      chat: RequestChat; input: RequestChatInput; review: RequestChatProposalReview;
      decisions: { action: RequestChatDecision; messageId: string }[];
      staleAccept?: HTMLButtonElement;
    };
  }
}

const summary = 'Move the desk to provide clearance.';
const baseRevisionId = 'a'.repeat(64);
const proposalRevisionId = 'b'.repeat(64);
const input: RequestChatInput = {
  projectId: 'project-one', title: 'Improve the office without changing its walls.', state: 'Ready', requestState: 'ready', activity: [],
  conversation: { version: 1, ticketId: 'ticket-one', sequence: 2, messages: [
    { kind: 'user', id: 'user-one', requestId: 'turn-one', sequence: 1, at: 1000, baseRevisionId,
      text: 'Improve the office without changing its walls.', sources: [], visual: null },
    { kind: 'assistant', id: 'assistant-one', requestId: 'turn-one', replyTo: 'user-one', sequence: 2, at: 1001, baseRevisionId,
      content: { kind: 'proposal', text: summary, proposalName: 'office-clearance', proposalRevisionId } },
  ] },
};
const review: RequestChatProposalReview = {
  messageId: 'assistant-one', requestId: 'turn-one', proposalRevisionId, summary,
  rationale: 'Leave a clear route to the door.', constraints: 'Keep existing walls.', uncertainty: 'Confirm the dimensions on site.',
  status: 'Ready for review', targetLabel: 'Courtyard option', canAccept: true, canReject: true, canRevise: true, delta: false,
};

async function mount(browser: Browser, bundle: string, inspected = true) {
  const page = await browser.newPage();
  await page.setContent('<div id="request-chat-mount" style="height:320px;overflow:auto"></div>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ input, review, inspected }) => {
    const host = document.getElementById('request-chat-mount');
    if (!host) throw new Error('Chat host is required.');
    const decisions: Window['chatTest']['decisions'] = [];
    const chat = new window.requestChatModule.RequestChat(host, {
      answer: () => {}, proposal: () => {}, inspect: () => {}, delta: () => {},
      decision: (action, messageId) => { decisions.push({ action, messageId }); },
    });
    window.chatTest = { chat, input, review, decisions };
    chat.show(input);
    if (inspected) chat.setProposalReview(review);
  }, { input, review, inspected });
  return page;
}

test('compact proposal review in a real browser', async t => {
  const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    entryPoints: ['demo/request-chat.ts'], bundle: true, write: false, platform: 'browser', format: 'iife',
    globalName: 'requestChatModule', target: 'es2023' });
  const script = bundle.outputFiles[0]?.text;
  assert.ok(script);
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'], ...(executablePath ? { executablePath } : {}) });
  t.after(() => browser.close());

  await t.test('one visible outcome and explicit target actions precede collapsed technical details', async t => {
    const page = await mount(browser, script); t.after(() => page.close());
    const card = page.locator('.request-chat-proposal');
    assert.equal(await card.getByText(summary, { exact: true }).count(), 1);
    assert.equal(await card.locator('.request-chat-outcome').isVisible(), true);
    assert.equal(await card.getByRole('button', { name: 'Accept into Courtyard option', exact: true }).isVisible(), true);
    assert.equal(await card.getByRole('button', { name: 'Request revision', exact: true }).isVisible(), true);
    assert.equal(await card.getByRole('button', { name: 'View changes', exact: true }).isVisible(), true);
    assert.equal(await card.getByText(review.rationale, { exact: true }).isVisible(), false);
    assert.equal(await card.getByText(baseRevisionId, { exact: true }).isVisible(), false);
    assert.equal(await card.getByText(proposalRevisionId, { exact: true }).isVisible(), false);
    assert.equal(await page.locator('#request-chat > header h3').textContent(), 'Chat');
    assert.equal(await page.locator('.request-chat-message-heading time').first().getAttribute('datetime'), new Date(1000).toISOString());
    assert.deepEqual(await page.evaluate(() => window.chatTest.decisions), []);
    await card.locator('summary').first().click();
    assert.equal(await card.getByText(review.rationale, { exact: true }).isVisible(), true);
    assert.equal(await card.getByText(proposalRevisionId, { exact: true }).isVisible(), true);
    await card.getByRole('button', { name: 'Accept into Courtyard option', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.chatTest.decisions), [{ action: 'accept', messageId: 'assistant-one' }]);
  });

  await t.test('inspection is required before any decision controls appear', async t => {
    const page = await mount(browser, script, false); t.after(() => page.close());
    const card = page.locator('.request-chat-proposal');
    assert.equal(await card.getByText(summary, { exact: true }).count(), 1);
    assert.equal(await card.getByRole('button', { name: 'Inspect proposal', exact: true }).isVisible(), true);
    assert.equal(await card.getByRole('button', { name: /Accept into|Request revision|Reject proposal/ }).count(), 0);
    await page.evaluate(() => window.chatTest.chat.setProposalReview({ ...window.chatTest.review, messageId: 'other-message' }));
    assert.equal(await card.getByRole('button', { name: /Accept into|Request revision|Reject proposal/ }).count(), 0);
  });

  await t.test('switching projects clears review authority and retains immutable source and visual bindings', async t => {
    const page = await mount(browser, script); t.after(() => page.close());
    await page.evaluate(() => {
      const oldAccept = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Accept into Courtyard option');
      if (!oldAccept) throw new Error('Acceptance action is required.');
      const { chat, input } = window.chatTest;
      chat.show({ ...input, projectId: 'project-two', conversation: { ...input.conversation,
        messages: input.conversation.messages.map(message => message.kind === 'user' ? { ...message,
          sources: [{ id: 'source-one', name: 'floor-plan.pdf', mediaType: 'application/pdf', byteLength: 128, sha256: 'c'.repeat(64) }],
          visual: { snapshot: { kind: 'accepted', revisionId: message.baseRevisionId }, view: '3d', levelId: null,
            selectedObjectIds: ['entry-door'], annotations: [] },
        } : message),
      } });
      oldAccept.click();
    });
    assert.deepEqual(await page.evaluate(() => window.chatTest.decisions), []);
    assert.equal(await page.getByRole('button', { name: /Accept into|Request revision|Reject proposal/ }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Inspect proposal', exact: true }).isVisible(), true);
    assert.equal(await page.getByRole('link', { name: 'floor-plan.pdf', exact: true }).getAttribute('href'), '/api/projects/project-two/sources/source-one');
    const source = page.locator('.source-reference');
    await source.locator('summary').click();
    assert.equal(await source.locator('code').textContent(), 'c'.repeat(64));
    const visual = page.locator('.request-chat-visual');
    await visual.locator('summary').click();
    assert.equal(await visual.getByText('Selected IDs: entry-door', { exact: true }).isVisible(), true);
    assert.equal(await visual.getByRole('button', { name: 'Inspect bound snapshot', exact: true }).isVisible(), true);
  });

  await t.test('review refresh keeps expanded details and action focus when the display name changes', async t => {
    const page = await mount(browser, script); t.after(() => page.close());
    const card = page.locator('.request-chat-proposal');
    await card.locator('summary').first().click();
    await card.getByRole('button', { name: 'Accept into Courtyard option', exact: true }).focus();
    await page.evaluate(() => {
      window.chatTest.chat.setProposalReview({ ...window.chatTest.review, targetLabel: 'Garden option', delta: true });
    });
    assert.equal(await card.getByText(review.rationale, { exact: true }).isVisible(), true);
    assert.equal(await card.getByRole('button', { name: 'Accept into Garden option', exact: true }).evaluate(button => button === document.activeElement), true);
    assert.equal(await card.getByRole('button', { name: 'Hide changes', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.chatTest.chat.show({ ...window.chatTest.input, activity: [
      { requestId: 'turn-one', sequence: 1, attempt: 1, stage: 'ready', at: 1002, message: 'Ready for human review.' },
    ] }));
    assert.equal(await card.getByText(review.rationale, { exact: true }).isVisible(), true);
    assert.equal(await card.getByRole('button', { name: 'Accept into Garden option', exact: true }).evaluate(button => button === document.activeElement), true);
  });

  await t.test('offline, disabled and stale retained controls cannot record a decision', async t => {
    const page = await mount(browser, script); t.after(() => page.close());
    const accept = page.getByRole('button', { name: 'Accept into Courtyard option', exact: true });
    await page.evaluate(() => window.chatTest.chat.setOffline(true));
    assert.equal(await accept.isDisabled(), true);
    await accept.dispatchEvent('click');
    assert.deepEqual(await page.evaluate(() => window.chatTest.decisions), []);
    assert.equal(await page.getByRole('status').textContent(), 'OfflineLast received status: Ready for review. Reconnect to refresh.');
    await page.evaluate(() => { window.chatTest.chat.setOffline(false); window.chatTest.chat.setDisabled(true); });
    assert.equal(await accept.isDisabled(), true);
    await accept.dispatchEvent('click');
    await page.evaluate(() => {
      window.chatTest.chat.setDisabled(false);
      const accept = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Accept into Courtyard option');
      if (!accept) throw new Error('Acceptance action is required.');
      window.chatTest.staleAccept = accept;
      window.chatTest.chat.setProposalReview({ ...window.chatTest.review, canAccept: false });
      accept.click();
    });
    assert.equal(await accept.count(), 0);
    await page.evaluate(() => {
      window.chatTest.chat.setProposalReview({ ...window.chatTest.review, proposalRevisionId: 'c'.repeat(64) });
      window.chatTest.staleAccept?.click();
    });
    assert.deepEqual(await page.evaluate(() => window.chatTest.decisions), []);
    assert.equal(await page.getByRole('button', { name: 'Inspect proposal', exact: true }).isVisible(), true);
  });

  await t.test('progress above a reader preserves the visible message and independently expanded turn details', async t => {
    const page = await mount(browser, script); t.after(() => page.close());
    const result = await page.evaluate(async () => {
      const { chat, input } = window.chatTest;
      const history = Array.from({ length: 12 }, (_, index) => ({
        kind: 'user', id: `history-${index}`, requestId: `earlier-turn-${index}`, sequence: index + 1,
        at: index, baseRevisionId: 'a'.repeat(64), text: 'Earlier model context. '.repeat(40), sources: [], visual: null,
      } satisfies ConversationMessage));
      const conversation = { ...input.conversation, sequence: 14, messages: [
        ...history, ...input.conversation.messages.map(message => ({ ...message, sequence: message.sequence + 12 })),
      ] };
      chat.show({ ...input, conversation });
      const host = document.getElementById('request-chat-mount');
      const expandedTurn = host?.querySelector('[data-message-id="history-0"] details');
      if (!host || !(expandedTurn instanceof HTMLDetailsElement)) throw new Error('History and turn activity are required.');
      expandedTurn.open = true;
      host.scrollTop = 900;
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
      const viewportTop = host.getBoundingClientRect().top + host.clientTop;
      const anchor = Array.from(host.querySelectorAll('[data-message-id]')).find(item => item.getBoundingClientRect().bottom > viewportTop);
      if (!(anchor instanceof HTMLElement)) throw new Error('A visible history message is required.');
      const before = anchor.getBoundingClientRect().top - viewportTop;
      chat.show({ ...input, conversation, activity: [
        { requestId: 'earlier-turn-0', sequence: 1, attempt: 1, stage: 'inspecting', at: 1000,
          message: 'Inspecting the geometry for the earlier request. '.repeat(15) },
      ] });
      const restored = Array.from(host.querySelectorAll('[data-message-id]')).find(item => item.getAttribute('data-message-id') === anchor.dataset.messageId);
      const restoredDetails = host.querySelector('[data-message-id="history-0"] details');
      const otherDetails = host.querySelector('[data-message-id="history-1"] details');
      return { before, after: restored ? restored.getBoundingClientRect().top - viewportTop : null,
        expanded: restoredDetails instanceof HTMLDetailsElement && restoredDetails.open,
        otherExpanded: otherDetails instanceof HTMLDetailsElement && otherDetails.open };
    });
    assert.equal(result.expanded, true);
    assert.equal(result.otherExpanded, false);
    assert.notEqual(result.after, null);
    assert.ok(Math.abs(result.before - (result.after ?? Infinity)) < 1, 'Polling should retain the visible history message at the same offset.');
  });
});
