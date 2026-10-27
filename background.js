// 多重起動を避け、すでに開いている視聴タブがあればそれを前面に出す
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('tv.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
});
