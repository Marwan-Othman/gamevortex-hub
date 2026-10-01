export default function AIWallpapersPage() {
  return (
    <main dir="auto" className="mx-auto min-h-screen max-w-5xl px-4 py-10">
      <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-2xl backdrop-blur-xl md:p-10">
        <p className="mb-2 text-sm font-semibold uppercase tracking-[0.2em] text-cyan-300">GameVortex AI</p>
        <h1 className="text-3xl font-black md:text-5xl">AI Wallpapers & Video</h1>
        <p className="mt-3 max-w-2xl text-white/60">
          GameVortex AI chat runs on the independent self-hosted AI runtime. No external media provider is required by the chat system.
        </p>
        <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5 text-white/70">
          Image and video generation are intentionally disabled until an independent media runtime is implemented. Existing media storage and deletion support remain available.
        </div>
      </div>
    </main>
  );
}
