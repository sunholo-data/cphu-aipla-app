// Workshop W5b — AG-UI: text events → chat bubbles
// StreamingBubble accumulates TEXT_MESSAGE_CONTENT deltas in the partial message
// passed from ChatMessageList. A blinking cursor (animate-pulse) signals live
// output. On TEXT_MESSAGE_END the parent swaps this for a finalised MessageBubble
// with no layout shift because the bubble dimensions stay stable during streaming.
// See: docs/talks/workshop.md §W5

"use client";

import type { SkillMessage } from "@/hooks/useSkillAgent";
import { BrandAvatar } from "@/components/chat/BrandAvatar";
import { ThinkingPanel } from "@/components/chat/ThinkingPanel";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { holdOpenMath } from "@/lib/mathDelimiters";

// A streaming bubble has no document panel to navigate; a chip that arrives
// mid-stream becomes live once the turn finalises into MessageBubble.
const noNavigate = () => {};

interface StreamingBubbleProps {
  message: SkillMessage;
  skillId: string;
  thinkingContent?: string;
  isThinking?: boolean;
}

export function StreamingBubble({ message, skillId, thinkingContent, isThinking }: StreamingBubbleProps) {
  return (
    <div className="flex items-start gap-3">
      <BrandAvatar />
      <div className="flex max-w-[80%] flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-orange-600">{skillId}</span>
        </div>
        <div className="rounded-[2px_8px_8px_8px] border-l-[3px] border-orange-400 bg-[hsl(0,0%,98%)] px-3 py-2 text-sm">
          {thinkingContent && (
            <ThinkingPanel content={thinkingContent} isThinking={isThinking ?? false} />
          )}
          {/* 1.1.147 M0: Markdown + KaTeX WHILE streaming, not only once the
              turn ends — the raw-text bubble showed `$…$` source on every
              turn and its swap for rendered Markdown at the end was a layout
              jump that broke auto-scroll. holdOpenMath holds back an unclosed
              `$`, `$$`, `\(`, `\[` or backtick at the tail, so neither source
              nor a half code span flashes. */}
          <ChatMarkdown content={holdOpenMath(message.content)} navigateToBlock={noNavigate} />
          <span className="ml-0.5 inline-block h-3.5 w-0.5 bg-orange-400 animate-pulse align-middle" />
        </div>
      </div>
    </div>
  );
}
