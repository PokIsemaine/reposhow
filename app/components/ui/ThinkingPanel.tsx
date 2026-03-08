'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface ThinkingPanelProps {
  content: string;
  isStreaming?: boolean;
}

export function ThinkingPanel({ content, isStreaming = true }: ThinkingPanelProps) {
  const [displayedContent, setDisplayedContent] = useState('');
  const [copied, setCopied] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  // Typewriter effect - only update when content actually changes
  useEffect(() => {
    if (!isStreaming) {
      setDisplayedContent(content);
      return;
    }

    // If the new content is longer than what we have, show the difference
    if (content.length > displayedContent.length) {
      const newContent = content.slice(displayedContent.length);
      // Add new content character by character for typewriter effect
      let charIndex = 0;
      const timer = setInterval(() => {
        if (charIndex < newContent.length) {
          setDisplayedContent(prev => prev + newContent[charIndex]);
          charIndex++;
        } else {
          clearInterval(timer);
        }
      }, 20); // Speed of typewriter effect

      return () => clearInterval(timer);
    } else if (content.length === 0) {
      setDisplayedContent('');
    }
  }, [content, isStreaming]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (contentRef.current && isStreaming) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [displayedContent, isStreaming]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [content]);

  return (
    <div style={{
      background: 'var(--color-bg)',
      border: 'var(--border-width) solid var(--color-border)',
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      {/* Header with copy button */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: 'var(--space-sm) var(--space-md)',
        borderBottom: 'var(--border-width) solid var(--color-border)',
        background: '#f5f5f5',
      }}>
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: '#666' }}>
          AI Thinking Process
        </span>
        <button
          onClick={handleCopy}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: 'var(--space-xs) var(--space-sm)',
            fontSize: 'var(--text-sm)',
            color: copied ? 'var(--color-success)' : '#666',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            borderRadius: 'var(--radius-sm)',
            transition: 'all 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#e5e5e5'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
        >
          {copied ? '✓ Copied' : '📋 Copy'}
        </button>
      </div>

      {/* Content area */}
      <div
        ref={contentRef}
        style={{
          padding: 'var(--space-md)',
          maxHeight: '400px',
          overflowY: 'auto',
          fontSize: 'var(--text-sm)',
          lineHeight: 1.6,
        }}
      >
        <ReactMarkdown
          components={{
            code({ className, children, ...props }) {
              const match = /language-(\w+)/.exec(className || '');
              const isInline = !match;

              if (isInline) {
                return (
                  <code
                    style={{
                      background: '#e5e5e5',
                      padding: '2px 4px',
                      borderRadius: '3px',
                      fontFamily: 'monospace',
                      fontSize: '0.9em',
                    }}
                    {...props}
                  >
                    {children}
                  </code>
                );
              }

              return (
                <SyntaxHighlighter
                  style={oneDark}
                  language={match[1]}
                  PreTag="div"
                  customStyle={{
                    margin: 'var(--space-sm) 0',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.85em',
                  }}
                >
                  {String(children).replace(/\n$/, '')}
                </SyntaxHighlighter>
              );
            },
            // Style blockquotes
            blockquote({ children }) {
              return (
                <blockquote style={{
                  borderLeft: '4px solid #ddd',
                  margin: 'var(--space-sm) 0',
                  paddingLeft: 'var(--space-md)',
                  color: '#666',
                  fontStyle: 'italic',
                }}>
                  {children}
                </blockquote>
              );
            },
            // Style lists
            ul({ children }) {
              return (
                <ul style={{
                  margin: 'var(--space-sm) 0',
                  paddingLeft: 'var(--space-lg)',
                }}>
                  {children}
                </ul>
              );
            },
            ol({ children }) {
              return (
                <ol style={{
                  margin: 'var(--space-sm) 0',
                  paddingLeft: 'var(--space-lg)',
                }}>
                  {children}
                </ol>
              );
            },
            // Style links
            a({ href, children }) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: 'var(--color-primary)',
                    textDecoration: 'underline',
                  }}
                >
                  {children}
                </a>
              );
            },
            // Style paragraphs
            p({ children }) {
              return (
                <p style={{ margin: 'var(--space-xs) 0' }}>
                  {children}
                </p>
              );
            },
          }}
        >
          {displayedContent || '*Waiting for thinking to start...*'}
        </ReactMarkdown>

        {/* Cursor indicator for streaming */}
        {isStreaming && displayedContent !== content && (
          <span style={{
            display: 'inline-block',
            width: '8px',
            height: '16px',
            background: 'var(--color-primary)',
            animation: 'blink 1s infinite',
            marginLeft: '2px',
            verticalAlign: 'middle',
          }} />
        )}
      </div>

      {/* Blinking cursor animation */}
      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
