import WorkbenchPage from "./pages/WorkbenchPage";

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <span className="font-bold">选题工具 v2 · 物证驱动</span>
          <span className="ml-2 text-xs text-muted-foreground">AI 当透镜，不当灵感源</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <WorkbenchPage />
      </main>
    </div>
  );
}
