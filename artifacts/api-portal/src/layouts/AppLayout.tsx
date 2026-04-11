import React, { useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  BarChart2, 
  Server, 
  ScrollText, 
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  Menu,
  X
} from "lucide-react";
import { useTheme } from "../components/theme-provider";
import { cn } from "../lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "统计", icon: BarChart2 },
  { href: "/models", label: "模型", icon: Server },
  { href: "/logs", label: "日志", icon: ScrollText },
  { href: "/settings", label: "设置", icon: LayoutDashboard },
];

export function AppLayout({ children, isSetup }: { children: React.ReactNode, isSetup?: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [location] = useLocation();

  if (isSetup) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col pt-12 items-center relative transition-colors duration-300">
        <div className="absolute top-6 right-6">
           <button 
             onClick={() => setTheme((theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) ? 'light' : 'dark')} 
             className="p-2 rounded-full border border-border bg-card hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground shadow-sm"
           >
              {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
           </button>
        </div>
        <div className="w-full max-w-xl px-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden transition-colors duration-300">
      {/* Sidebar (Desktop) */}
      <aside className={cn(
        "hidden md:flex flex-col bg-sidebar-bg border-r border-sidebar-border transition-all duration-300 ease-in-out relative z-20 shadow-sm",
        collapsed ? "w-[80px]" : "w-[240px]"
      )}>
        <div className="h-16 flex items-center px-4 border-b border-sidebar-border/60 flex-shrink-0">
          <div className="flex items-center gap-3 overflow-hidden w-full h-full justify-center md:justify-start">
             <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex flex-shrink-0 items-center justify-center text-primary font-bold text-lg shadow-sm">
               R
             </div>
             {!collapsed && <span className="font-bold text-[15px] tracking-wide whitespace-nowrap text-foreground bg-clip-text">Unified Layer</span>}
          </div>
        </div>

        <div className="flex-1 py-6 flex flex-col gap-1.5 px-3 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href}>
                <a className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 relative group cursor-pointer",
                  isActive 
                    ? "bg-primary/10 text-primary font-medium" 
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  collapsed && "justify-center px-0"
                )}>
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full" />
                  )}
                  <Icon size={18} className={cn("flex-shrink-0", isActive && "text-primary")} />
                  {!collapsed && <span className="text-sm">{item.label}</span>}
                  {collapsed && (
                    <div className="absolute left-full ml-3 px-2.5 py-1 bg-popover text-popover-foreground text-xs font-medium rounded-md shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-50 border border-border scale-95 group-hover:scale-100 transition-all origin-left">
                      {item.label}
                    </div>
                  )}
                </a>
              </Link>
            )
          })}
        </div>

        <div className="p-4 border-t border-sidebar-border/60 flex justify-center flex-shrink-0">
          <button 
            onClick={() => setCollapsed(!collapsed)}
            className="p-2 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors border border-transparent hover:border-border"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen relative z-10 w-full">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-4 md:px-6 border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40 supports-[backdrop-filter]:bg-background/60">
           
           {/* Mobile menu toggle */}
           <div className="md:hidden flex items-center gap-3">
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-2 -ml-2 text-muted-foreground hover:text-foreground">
                <Menu size={20} />
              </button>
              <div className="font-bold flex items-center gap-2">
                 <div className="w-6 h-6 rounded flex items-center justify-center text-primary font-bold text-sm bg-primary/10">R</div>
                 <span className="text-sm">Unified Layer</span>
              </div>
           </div>
           
           <div className="hidden md:block text-sm font-medium text-muted-foreground capitalize">
             {location === '/' ? 'Stats' : location.slice(1)}
           </div>

           <div className="flex items-center gap-4">
             <button
               onClick={() => setTheme((theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) ? 'light' : 'dark')}
               className="h-9 w-9 rounded-full border border-border bg-background hover:bg-secondary text-muted-foreground hover:text-foreground transition-all flex items-center justify-center shadow-sm"
               aria-label="Toggle theme"
             >
               {theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches) ? <Sun size={16} className="text-yellow-500" /> : <Moon size={16} className="text-indigo-500" />}
             </button>
           </div>
        </header>
        
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6 lg:p-8 relative bg-secondary/20 block">
           <div key={location} className="max-w-6xl mx-auto w-full h-full animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
              {children}
           </div>
        </main>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="absolute top-0 bottom-0 left-0 w-64 bg-sidebar-bg border-r border-sidebar-border shadow-xl animate-in slide-in-from-left">
            <div className="h-16 flex items-center justify-between px-4 border-b border-border">
              <span className="font-bold text-lg text-foreground bg-clip-text">导航</span>
              <button onClick={() => setMobileMenuOpen(false)} className="p-2 text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>
            <div className="py-4 px-3 flex flex-col gap-2">
              {NAV_ITEMS.map((item) => (
                <Link key={item.href} href={item.href}>
                  <a 
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-lg transition-colors cursor-pointer text-sm font-medium",
                    location === item.href ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}>
                    <item.icon size={18} />
                    <span>{item.label}</span>
                  </a>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
