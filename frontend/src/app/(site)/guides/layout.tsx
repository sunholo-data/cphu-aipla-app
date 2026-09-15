import { GuidesMobileNav, GuidesSidebar } from "@/components/guides/GuidesSidebar";
import { SiteHeader } from "@/components/site/SiteHeader";

/**
 * The guides section (1.1.116) — laid out like /project, because they are the
 * same kind of surface. The guides used to be static Quarto documents with
 * their own Bootstrap typography and no way back into the app; the chrome now
 * comes from the app, and every guide keeps the rail beside it.
 *
 * Everything but the prose is `print:hidden`, so printing a guide (or letting
 * `make guides-pdf` print it) yields the guide and nothing else.
 */
export default function GuidesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="print:hidden">
        <SiteHeader />
      </div>
      <GuidesMobileNav />
      <div className="mx-auto flex max-w-7xl">
        <GuidesSidebar />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
