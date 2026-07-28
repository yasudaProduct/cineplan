// 法務系静的ページの共通レイアウト（P5-4・07 §1.6）
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-bold">{title}</h1>
      <div className="mt-6 flex flex-col gap-5 text-sm leading-relaxed text-neutral-700">
        {children}
      </div>
    </main>
  )
}

export function LegalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-bold text-base text-neutral-900">{title}</h2>
      <div className="mt-1 flex flex-col gap-2">{children}</div>
    </section>
  )
}
