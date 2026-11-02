export const chatIconPaths = {
  more: 'M4 8h.01M8 8h.01M12 8h.01',
  new: 'M8 3v10M3 8h10',
  inspect: 'M1 8s2.5-4 7-4s7 4 7 4s-2.5 4-7 4s-7-4-7-4M8 6a2 2 0 1 0 0 4a2 2 0 0 0 0-4',
} satisfies Record<string, string>;

export function setChatIcon(button: HTMLButtonElement, label: string, icon: keyof typeof chatIconPaths): void {
  button.setAttribute('aria-label', label); button.title = label; button.classList.add('chat-icon-button');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', chatIconPaths[icon]); svg.append(path);
  button.replaceChildren(svg);
}
