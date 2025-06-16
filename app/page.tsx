import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import PromptInputWithActions from "@/components/chatbot";

export default function Page() {
  return (
    <SidebarProvider
      style={{
        "--sidebar-width": "calc(var(--spacing) * 72)",
        "--header-height": "calc(var(--spacing) * 12)",
      } as React.CSSProperties}
    >
      <AppSidebar variant="inset" />
      <SidebarInset>
        <SiteHeader />
        <main className="flex-1 overflow-hidden flex flex-col items-center justify-center">
          <div className="flex-1 flex flex-col items-center justify-center w-full">
            <div className="rounded-lg border bg-card w-full max-w-6xl flex flex-col">
              <PromptInputWithActions />
            </div>
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
