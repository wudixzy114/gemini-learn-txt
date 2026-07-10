import React, { memo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { IconCopy, IconCheck } from './icons.jsx';

function getTextContent(value) {
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(getTextContent).join('');
  if (React.isValidElement(value)) return getTextContent(value.props.children);
  return '';
}

function CopyButton({ getText, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked; ignore */ }
  }, [getText]);
  return (
    <button className="copy-btn" onClick={onCopy} type="button" aria-label={label}>
      {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
      <span>{copied ? 'Copied' : label}</span>
    </button>
  );
}

// A fenced code block: language label + copy button + highlighted body.
function CodeBlock({ className, children }) {
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : 'text';
  const raw = getTextContent(children);
  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="code-lang">{lang}</span>
        <CopyButton getText={() => raw.replace(/\n$/, '')} />
      </div>
      <pre className={className}>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

const components = {
  code({ inline, className, children, node, ...props }) {
    // react-markdown v9 no longer passes `inline`. Detect a block by a
    // language-* className or a newline in the content; treat everything
    // else as an inline code span.
    const text = String(children ?? '');
    const hasLang = /language-(\w+)/.test(className || '');
    const isBlock = inline === false || hasLang || text.includes('\n');
    if (!isBlock) {
      return (
        <code className="inline-code" {...props}>
          {children}
        </code>
      );
    }
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  // Render code fences (which arrive wrapped in <pre>) via our CodeBlock,
  // avoiding a doubled <pre>. The `code` handler already emits <pre>.
  pre({ children }) {
    return <>{children}</>;
  },
  a({ href, children, ...props }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
        {children}
      </a>
    );
  },
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

function MarkdownImpl({ content }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeKatex,
          [rehypeHighlight, { detect: true, ignoreMissing: true }],
        ]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

// Memoize so streaming a long assistant message doesn't re-render finished ones.
export const Markdown = memo(MarkdownImpl, (a, b) => a.content === b.content);
