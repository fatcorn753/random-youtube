// 拡張の視聴ページから iframe で開かれる再生専用ページ。
// chrome-extension:// から直接埋め込むと YouTube が埋め込み元を識別できずエラー 153 になるため、
// https のページ経由で再生する。親とは postMessage だけでやり取りする。
let player = null;
let ready = false;
let pending = null;
let parentOrigin = null;

const send = (msg) => parentOrigin && window.parent.postMessage(msg, parentOrigin);

function load(id) {
  pending = id;
  if (!ready) return;
  player.loadVideoById(id);
  pending = null;
}

window.addEventListener('message', (ev) => {
  if (ev.source !== window.parent || ev.data?.type !== 'load' || typeof ev.data.id !== 'string') return;
  parentOrigin = ev.origin;
  load(ev.data.id);
});

window.onYouTubeIframeAPIReady = () => {
  player = new YT.Player('p', {
    width: '100%',
    height: '100%',
    playerVars: { autoplay: 1, rel: 0, playsinline: 1 },
    events: {
      onReady: () => {
        ready = true;
        send({ type: 'ready' });
        if (pending) load(pending);
      },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED) send({ type: 'ended' });
      },
      onError: (e) => send({ type: 'error', code: e.data }),
    },
  });
};
