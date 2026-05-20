import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={copy}
      className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[11px] font-mono opacity-0 group-hover:opacity-100 transition-opacity bg-muted-foreground/20 hover:bg-muted-foreground/30 text-muted-foreground"
      aria-label="Copy code"
    >
      {copied ? 'copied' : 'copy'}
    </button>
  )
}

const components: Components = {
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,

  h1: ({ children }) => <h1 className="text-xl font-semibold mt-5 mb-2 first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-semibold mt-4 mb-2 first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-semibold mt-3 mb-1 first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="text-sm font-semibold mt-3 mb-1 first:mt-0">{children}</h4>,

  ul: ({ children }) => <ul className="mb-3 last:mb-0 pl-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 last:mb-0 pl-5 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,

  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-muted-foreground/40 pl-3 my-3 text-muted-foreground italic">
      {children}
    </blockquote>
  ),

  hr: () => <hr className="my-4 border-border" />,

  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:opacity-80">
      {children}
    </a>
  ),

  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,

  code: ({ children, className }) => {
    const isBlock = className?.startsWith('language-')
    if (isBlock) return <code className={className}>{children}</code>
    return (
      <code className="px-1 py-0.5 rounded text-[0.85em] font-mono bg-black/10 dark:bg-white/10">
        {children}
      </code>
    )
  },

  pre: ({ children }) => {
    const code = (children as React.ReactElement)?.props?.children ?? ''
    const text = typeof code === 'string' ? code : Array.isArray(code) ? code.join('') : ''
    return (
      <div className="relative group my-3">
        <pre className="overflow-x-auto rounded-lg bg-black/[0.06] dark:bg-white/[0.06] px-4 py-3 text-[0.82em] font-mono leading-relaxed">
          {children}
        </pre>
        <CopyButton text={text} />
      </div>
    )
  },

  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border/50 last:border-0">{children}</tr>,
  th: ({ children }) => <th className="text-left font-semibold px-3 py-2 first:pl-0 last:pr-0">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 first:pl-0 last:pr-0">{children}</td>,
}

export function Markdown({ content }: { content: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  )
}
