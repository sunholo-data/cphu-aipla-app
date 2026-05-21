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
});
