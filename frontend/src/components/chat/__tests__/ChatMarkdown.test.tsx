import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";

const noop = () => {};

describe("ChatMarkdown", () => {
  it("renders bold text as <strong>", () => {
    const { container } = render(
      <ChatMarkdown content="**bold word**" navigateToBlock={noop} />,
    );
    expect(container.querySelector("strong")).toBeTruthy();
    expect(container.querySelector("strong")?.textContent).toBe("bold word");
  });

  it("renders italic text as <em>", () => {
    const { container } = render(
      <ChatMarkdown content="*italic word*" navigateToBlock={noop} />,
    );
    expect(container.querySelector("em")).toBeTruthy();
  });

  it("renders GFM table as <table>", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    const { container } = render(
      <ChatMarkdown content={md} navigateToBlock={noop} />,
    );
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("renders fenced code block with a code element", () => {
    const md = "```js\nconsole.log('hi');\n```";
    const { container } = render(
      <ChatMarkdown content={md} navigateToBlock={noop} />,
    );
    expect(container.querySelector("code")).toBeTruthy();
  });

  it("renders aitana:// link as InlineCitation chip (button), not plain <a>", () => {
    const md = "[Source](aitana://doc/doc1/block/blk1)";
    const { container } = render(
      <ChatMarkdown content={md} navigateToBlock={noop} />,
    );
    // InlineCitation for aitana:// renders as a <button>
    expect(container.querySelector("button")).toBeTruthy();
    expect(container.querySelector("a")).toBeFalsy();
  });

  it("calls navigateToBlock when an aitana:// chip is clicked", async () => {
    const navigateToBlock = vi.fn();
    const md = "[Source](aitana://doc/doc42/block/blk7)";
    const { container } = render(
      <ChatMarkdown content={md} navigateToBlock={navigateToBlock} />,
    );
    const btn = container.querySelector("button") as HTMLButtonElement;
    btn.click();
    expect(navigateToBlock).toHaveBeenCalledWith("doc42", "blk7");
  });

  it("renders external https link as <a> (not stripped)", () => {
    const md = "[Google](https://google.com)";
    const { container } = render(
      <ChatMarkdown content={md} navigateToBlock={noop} />,
    );
    const anchor = container.querySelector("a");
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute("href")).toBe("https://google.com");
  });

  it("strips raw <script> HTML from output (XSS prevention)", () => {
    const { container } = render(
      <ChatMarkdown content="<script>alert(1)</script>" navigateToBlock={noop} />,
    );
    // No executable <script> element — the content may appear as escaped text which is safe
    expect(container.querySelector("script")).toBeFalsy();
  });

  it("strips other raw HTML tags from output", () => {
    const { container } = render(
      <ChatMarkdown content="<img src=x onerror=alert(1)>" navigateToBlock={noop} />,
    );
    expect(container.querySelector("img")).toBeFalsy();
  });

  it("renders plain text unchanged", () => {
    render(<ChatMarkdown content="Hello world" navigateToBlock={noop} />);
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("renders raw <svg>...</svg> blocks as inline images (not stripped as HTML)", async () => {
    const svg = '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" stroke="black" fill="none"/></svg>';
    const { container } = render(
      <ChatMarkdown content={`Here is a sketch:\n\n${svg}\n\nDoes that help?`} navigateToBlock={noop} />,
    );
    // SVGBlock dynamically imports DOMPurify and sets the sanitised SVG via
    // dangerouslySetInnerHTML in an effect — wait for that.
    await new Promise((r) => setTimeout(r, 50));
    // The SVG container exists AND the inner <svg> survived sanitisation.
    expect(container.querySelector(".svg-container svg")).toBeTruthy();
    expect(container.querySelector(".svg-container circle")).toBeTruthy();
  });

  it("renders ```svg fenced blocks as inline images", async () => {
    const fenced = "```svg\n<svg viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\" fill=\"none\" stroke=\"black\"/></svg>\n```";
    const { container } = render(<ChatMarkdown content={fenced} navigateToBlock={noop} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector(".svg-container svg")).toBeTruthy();
    expect(container.querySelector(".svg-container rect")).toBeTruthy();
  });

  it("renders ```xml fenced SVG as image (not as code) — agents reach for xml since SVG is XML", async () => {
    const fenced = '```xml\n<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10"/></svg>\n```';
    const { container } = render(<ChatMarkdown content={fenced} navigateToBlock={noop} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector(".svg-container svg")).toBeTruthy();
    expect(container.querySelector(".svg-container line")).toBeTruthy();
  });

  it("renders ```html fenced SVG as image (agents that think of SVG as HTML)", async () => {
    const fenced = '```html\n<svg viewBox="0 0 10 10"><polyline points="0,0 5,5 10,0"/></svg>\n```';
    const { container } = render(<ChatMarkdown content={fenced} navigateToBlock={noop} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector(".svg-container svg")).toBeTruthy();
    expect(container.querySelector(".svg-container polyline")).toBeTruthy();
  });

  it("does NOT extract a fenced code block that just MENTIONS svg in non-SVG content", async () => {
    // A code block whose body doesn't start with <svg should render as code,
    // not get caught by the SVG regex.
    const fenced = '```xml\n<foo><bar>hello</bar></foo>\n```';
    const { container } = render(<ChatMarkdown content={fenced} navigateToBlock={noop} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector(".svg-container svg")).toBeFalsy();
    // Should be in a code block instead.
    expect(container.querySelector("pre code")).toBeTruthy();
  });

  // CHAT-SVG-STREAMING-PLACEHOLDER (sprint 2026-06-04): reserve the
  // placeholder div as soon as <svg opens, not when </svg> closes. The
  // closing-tag moment used to slam a 160px box into the layout in one
  // frame; now it's reserved at the START of the SVG stream and the
  // closing-tag transition reconciles in place.
  describe("streaming SVG placeholder (CHAT-SVG-STREAMING-PLACEHOLDER)", () => {
    it("renders a placeholder (aria-busy) for an open <svg with no </svg> yet", async () => {
      // Simulates the streaming window: agent emitted the opening tag
      // and some children but the closing tag hasn't arrived.
      const partial =
        'Here is the free-body diagram:\n\n<svg viewBox="0 0 100 100">\n  <rect x="10" y="10" width="80" height="80"';
      const { container } = render(
        <ChatMarkdown content={partial} navigateToBlock={noop} />,
      );
      await new Promise((r) => setTimeout(r, 50));
      // The placeholder div is rendered. It has the same aria-busy +
      // svg-container class as SVGBlock's pre-sanitise state, so the
      // closing-tag transition is in-place.
      const placeholder = container.querySelector(
        '.svg-container[aria-busy="true"]',
      );
      expect(placeholder).toBeTruthy();
      // The placeholder does NOT contain a real SVG yet.
      expect(container.querySelector(".svg-container svg")).toBeFalsy();
    });

    it("renders a placeholder for an open <svg even without any children yet", async () => {
      // Earliest streaming state: just <svg ... and that's it.
      const justOpened = "Here:\n\n<svg viewBox=\"0 0 100 100\"";
      const { container } = render(
        <ChatMarkdown content={justOpened} navigateToBlock={noop} />,
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(
        container.querySelector('.svg-container[aria-busy="true"]'),
      ).toBeTruthy();
    });

    it("does NOT trigger the streaming placeholder for in-prose mentions of <svg>", async () => {
      // Critical: the tail regex is anchored to end-of-string. In-prose
      // mentions are followed by more text, so they shouldn't match.
      const inProse =
        "You can use the <svg> tag in HTML to draw vector graphics. It's part of the SVG specification.";
      const { container } = render(
        <ChatMarkdown content={inProse} navigateToBlock={noop} />,
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(
        container.querySelector('.svg-container[aria-busy="true"]'),
      ).toBeFalsy();
    });

    it("when the closing tag arrives the full SVG renders (no leftover placeholder)", async () => {
      // Re-rendering with the complete content swaps the placeholder
      // out for the real SVGBlock. The DOM container class is the
      // same — React reconciles in place.
      const partial =
        'Diagram:\n\n<svg viewBox="0 0 10 10">\n  <circle cx="5" cy="5"';
      const complete =
        'Diagram:\n\n<svg viewBox="0 0 10 10">\n  <circle cx="5" cy="5" r="4"/>\n</svg>';
      const { container, rerender } = render(
        <ChatMarkdown content={partial} navigateToBlock={noop} />,
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(
        container.querySelector('.svg-container[aria-busy="true"]'),
      ).toBeTruthy();

      rerender(<ChatMarkdown content={complete} navigateToBlock={noop} />);
      // After DOMPurify resolves, the placeholder is gone and the real
      // SVG is rendered.
      await new Promise((r) => setTimeout(r, 50));
      expect(container.querySelector(".svg-container svg")).toBeTruthy();
      expect(container.querySelector(".svg-container circle")).toBeTruthy();
      // No lingering placeholder div.
      expect(
        container.querySelector('.svg-container[aria-busy="true"]'),
      ).toBeFalsy();
    });

    it("with one complete SVG + one streaming SVG in the same content, the streaming one gets the placeholder", async () => {
      // The first SVG closes properly; the second is still streaming
      // at the tail. Pre-processor extracts the first as a sentinel
      // (real SVGBlock) and the trailing partial as a streaming
      // sentinel (placeholder).
      const mixed =
        '<svg viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10"/></svg>\n\nAnd here\'s the next one:\n\n<svg viewBox="0 0 20 20">\n  <polygon';
      const { container } = render(
        <ChatMarkdown content={mixed} navigateToBlock={noop} />,
      );
      await new Promise((r) => setTimeout(r, 50));
      // Real SVG for the first (closed) block.
      expect(container.querySelector(".svg-container svg line")).toBeTruthy();
      // Placeholder for the second (still streaming) block.
      expect(
        container.querySelector('.svg-container[aria-busy="true"]'),
      ).toBeTruthy();
    });
  });
});
