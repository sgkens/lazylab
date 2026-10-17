import React, { useState, useRef } from 'react';
import { Bold, Italic, Code, ListChecks, Heading2, Link2, Image, Eye, Edit3, Paperclip } from 'lucide-react';
import { renderMarkdownToHtml } from '../utils/markdown';

interface MarkdownEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  minHeight?: string;
  allowAttachments?: boolean;
  onAttachmentDropped?: (file: File) => void;
}

export const MarkdownEditor: React.FC<MarkdownEditorProps> = ({
  value,
  onChange,
  placeholder = 'Write in markdown...',
  minHeight = '140px',
  allowAttachments = true,
  onAttachmentDropped
}) => {
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write');
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertText = (prefix: string, suffix = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.substring(start, end);
    const replacement = prefix + (selected || 'text') + suffix;

    const newValue = value.substring(0, start) + replacement + value.substring(end);
    onChange(newValue);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + replacement.length - suffix.length);
    }, 10);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!allowAttachments) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      handleFileUpload(file);
      if (onAttachmentDropped) onAttachmentDropped(file);
    }
  };

  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const isImg = file.type.startsWith('image/');
      const snippet = isImg
        ? `\n![${file.name}](${result})\n`
        : `\n[📎 ${file.name}](${result})\n`;
      onChange(value + snippet);
    };
    reader.readAsDataURL(file);
  };

  const renderHtml = () => {
    try {
      return { __html: renderMarkdownToHtml(value || '*No content provided.*') };
    } catch {
      return { __html: value };
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      className={`border rounded-lg overflow-hidden transition-colors ${
        isDragging
          ? 'border-orange-500 bg-orange-500/5 ring-1 ring-orange-500'
          : 'border-zinc-800 dark:border-zinc-800 bg-zinc-950/60 dark:bg-zinc-950/90'
      }`}
    >
      {/* Formatting Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 bg-zinc-900/60 text-xs">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => insertText('**', '**')}
            title="Bold"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertText('*', '*')}
            title="Italic"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertText('### ')}
            title="Heading"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertText('`', '`')}
            title="Inline Code"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertText('- [ ] ')}
            title="Checklist Item"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <ListChecks className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => insertText('[', '](https://)')}
            title="Link"
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>

          {allowAttachments && (
            <label
              title="Attach File / Screenshot"
              className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <Paperclip className="w-3.5 h-3.5" />
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
              />
            </label>
          )}
        </div>

        {/* Write / Preview Tab Switcher */}
        <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded border border-zinc-800">
          <button
            type="button"
            onClick={() => setActiveTab('write')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
              activeTab === 'write'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Edit3 className="w-3 h-3" />
            <span>Write</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('preview')}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
              activeTab === 'preview'
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Eye className="w-3 h-3" />
            <span>Preview</span>
          </button>
        </div>
      </div>

      {/* Editor Body */}
      {activeTab === 'write' ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ minHeight }}
          className="w-full bg-transparent p-3 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none resize-y font-mono leading-relaxed"
        />
      ) : (
        <div
          style={{ minHeight }}
          className="p-3 text-xs text-zinc-200 prose prose-invert max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:my-1 overflow-y-auto leading-relaxed"
          dangerouslySetInnerHTML={renderHtml()}
        />
      )}

      {allowAttachments && (
        <div className="px-3 py-1 bg-zinc-950/40 border-t border-zinc-800/80 text-[10px] text-zinc-500 font-mono flex items-center justify-between">
          <span>Drop files or screenshots here to attach</span>
          <span>Markdown supported</span>
        </div>
      )}
    </div>
  );
};
