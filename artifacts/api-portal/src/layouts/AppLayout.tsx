import React, { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  BarChart2, 
  Server, 
  Waypoints,
  MessageSquare,
  ScrollText, 
  BookOpen,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  Settings2,
  Menu,
  X
} from "lucide-react";
import { useTheme } from "../components/theme-provider";
import { cn } from "../lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "仪表盘", icon: LayoutDashboard },
  { href: "/chat", label: "在线聊天", icon: MessageSquare },
  { href: "/stats", label: "统计", icon: BarChart2 },
  { href: "/nodes", label: "子节点", icon: Waypoints },
  { href: "/models", label: "模型", icon: Server },
  { href: "/logs", label: "日志", icon: ScrollText },
  { href: "/docs", label: "文档", icon: BookOpen },
  { href: "/settings", label: "设置", icon: Settings2 },
];

const PAGE_TITLES: Record<string, string> = {
  "/": "仪表盘",
  "/chat": "在线聊天",
  "/stats": "统计",
  "/nodes": "子节点",
  "/models": "模型",
  "/logs": "日志",
  "/docs": "文档",
  "/settings": "设置",
};

const PAGE_DESCRIPTIONS: Record<string, string> = {
  "/": "查看服务状态、版本信息和入口概览。",
  "/chat": "直接在网页里验证模型、路由和流式返回。",
  "/stats": "检查调用量、token 消耗与费用参考。",
  "/nodes": "管理子节点、路由策略和节点健康情况。",
  "/models": "统一开关模型，控制当前服务对外暴露的能力。",
  "/logs": "查看最近请求和异常记录，快速定位问题。",
  "/docs": "复制接入地址，查看接口说明和使用方式。",
  "/settings": "处理兼容模式和本地控制项。",
};

const PAGE_BADGES: Record<string, string> = {
  "/": "Overview",
  "/chat": "Realtime",
  "/stats": "Usage",
  "/nodes": "Fleet",
  "/models": "Catalog",
  "/logs": "Events",
  "/docs": "Manual",
  "/settings": "Controls",
};

export function AppLayout({ children, isSetup }: { children: React.ReactNode, isSetup?: boolean }) {
  const [collapsed, setCollapsed] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const [location] = useLocation();
  const isDarkMode =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const pageTitle = PAGE_TITLES[location] ?? location.slice(1);
  const pageDescription = PAGE_DESCRIPTIONS[location] ?? "自用控制台。";
  const pageBadge = PAGE_BADGES[location] ?? "Portal";

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  if (isSetup) {
    return (
      <div className="min-h-screen text-foreground flex flex-col pt-12 items-center relative transition-colors duration-300 overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 top-8 h-64 w-64 rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute right-[-6rem] top-[-2rem] h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
          <div className="absolute bottom-[-10rem] left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-emerald-400/15 blur-3xl" />
        </div>
        <div className="absolute top-5 right-5 z-20 sm:top-6 sm:right-6">
           <button 
             onClick={() => setTheme(isDarkMode ? "light" : "dark")}
             className="flex h-11 w-11 items-center justify-center rounded-full border border-white/50 dark:border-white/10 bg-white/55 dark:bg-slate-950/45 backdrop-blur-xl hover:bg-white/80 dark:hover:bg-slate-900/60 transition-all duration-300 text-muted-foreground hover:text-foreground shadow-[0_18px_50px_-28px_rgba(15,23,42,0.65)]"
             aria-label="Toggle theme"
           >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
           </button>
        </div>
        <div className="w-full max-w-2xl px-4 animate-in fade-in slide-in-from-bottom-4 duration-500 relative z-10">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className="relative isolate flex h-screen w-full text-foreground overflow-hidden transition-colors duration-300">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-28 top-14 h-72 w-72 rounded-full bg-primary/18 blur-3xl" />
        <div className="absolute right-[-9rem] top-[-3rem] h-[24rem] w-[24rem] rounded-full bg-amber-400/16 blur-3xl" />
        <div className="absolute bottom-[-10rem] left-1/3 h-[28rem] w-[28rem] rounded-full bg-emerald-400/12 blur-3xl" />
      </div>
      {/* Sidebar (Desktop) */}
      <aside className={cn(
        "hidden md:flex flex-col border-r overflow-hidden transition-[width,background-color,border-color,box-shadow] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] relative z-20 shadow-[18px_0_60px_-46px_rgba(15,23,42,0.85)] backdrop-blur-2xl",
        "bg-white/50 dark:bg-slate-950/45 border-white/40 dark:border-white/8",
        collapsed ? "w-[80px]" : "w-[240px]"
      )}>
        <div className="h-20 flex items-center px-4 border-b border-white/40 dark:border-white/8 flex-shrink-0">
          <div className="flex items-center gap-3 overflow-hidden w-full h-full justify-center md:justify-start">
             <div className="relative flex h-11 w-11 flex-shrink-0 items-center justify-center">
               <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/30 via-primary/12 to-emerald-400/20 blur-md" />
               <div className="relative flex h-11 w-11 items-center justify-center rounded-2xl border border-white/60 dark:border-white/10 bg-white/80 dark:bg-slate-900/70 text-primary font-extrabold text-lg shadow-inner">
                 R
               </div>
             </div>
             <div
               className={cn(
                 "min-w-0 overflow-hidden transition-[max-width,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                 collapsed ? "max-w-0 opacity-0 -translate-x-2" : "max-w-[10rem] opacity-100 translate-x-0 delay-75",
               )}
             >
                 <div className="text-[11px] uppercase tracking-[0.26em] text-primary/75">RT</div>
                 <span className="block font-extrabold text-[15px] tracking-wide whitespace-nowrap text-foreground">Control Surface</span>
             </div>
          </div>
        </div>

        <div className="flex-1 py-6 flex flex-col gap-1.5 px-3 overflow-x-hidden overflow-y-auto">
          <div
            className={cn(
              "px-3 overflow-hidden transition-[max-height,opacity,transform,padding] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)]",
              collapsed ? "max-h-0 pb-0 opacity-0 -translate-y-2 pointer-events-none" : "max-h-40 pb-3 opacity-100 translate-y-0",
            )}
          >
              <div className="rounded-2xl border border-white/55 dark:border-white/8 bg-white/55 dark:bg-slate-900/45 px-3 py-3 backdrop-blur-xl">
                <div className="text-[11px] uppercase tracking-[0.24em] text-primary/70">Workspace</div>
                <div className="mt-1 text-sm font-semibold text-foreground">Self-hosted Portal</div>
                <div className="mt-1 text-xs leading-relaxed text-muted-foreground">集中管理模型、节点、日志和统计。</div>
              </div>
          </div>
          {NAV_ITEMS.map((item) => {
            const isActive = location === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-2xl transition-all duration-200 relative group cursor-pointer border",
                  isActive 
                    ? "border-primary/20 bg-gradient-to-r from-primary/18 via-primary/8 to-transparent text-foreground font-semibold shadow-[0_24px_60px_-38px_rgba(37,99,235,0.85)]"
                    : "border-transparent text-muted-foreground hover:bg-white/45 dark:hover:bg-slate-900/40 hover:border-white/50 dark:hover:border-white/8 hover:text-foreground",
                  collapsed && "justify-center px-0"
                )}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-primary rounded-r-full" />
                )}
                <Icon size={18} className={cn("flex-shrink-0", isActive && "text-primary")} />
                <span
                  className={cn(
                    "overflow-hidden whitespace-nowrap text-sm transition-[max-width,opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    collapsed ? "max-w-0 opacity-0 -translate-x-2" : "max-w-[8rem] opacity-100 translate-x-0 delay-75",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            )
          })}
        </div>

        <div className="p-4 border-t border-white/40 dark:border-white/8 flex justify-center flex-shrink-0">
          <button 
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-11 w-11 items-center justify-center rounded-2xl text-muted-foreground hover:bg-white/55 dark:hover:bg-slate-900/45 hover:text-foreground transition-all duration-300 border border-white/45 dark:border-white/8"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen relative z-10 w-full">
        {/* Header */}
        <header className="h-20 flex items-center justify-between px-4 md:px-6 border-b border-white/35 dark:border-white/8 bg-white/35 dark:bg-slate-950/25 backdrop-blur-2xl sticky top-0 z-40">
           
           {/* Mobile menu toggle */}
           <div className="md:hidden flex items-center gap-3">
              <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/45 dark:border-white/10 bg-white/45 dark:bg-slate-900/45 text-muted-foreground hover:text-foreground">
                <Menu size={20} />
              </button>
              <div className="font-bold flex items-center gap-2">
                 <div className="flex h-8 w-8 rounded-xl items-center justify-center text-primary font-bold text-sm bg-white/65 dark:bg-slate-900/60 border border-white/45 dark:border-white/10">R</div>
                 <div>
                   <div className="text-[11px] uppercase tracking-[0.22em] text-primary/70">{pageBadge}</div>
                   <span className="text-sm">{pageTitle}</span>
                 </div>
              </div>
           </div>
           
           <div className="hidden md:flex items-center gap-4 min-w-0">
             <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/55 dark:border-white/8 bg-white/60 dark:bg-slate-900/50 text-primary shadow-inner">
               <span className="text-[11px] font-bold uppercase tracking-[0.22em]">{pageBadge.slice(0, 2)}</span>
             </div>
             <div className="min-w-0">
               <div className="text-[11px] uppercase tracking-[0.28em] text-primary/70">{pageBadge}</div>
               <div className="text-lg font-bold tracking-tight text-foreground">{pageTitle}</div>
             </div>
           </div>

           <div className="hidden xl:block flex-1 max-w-xl px-6">
             <div className="text-sm text-muted-foreground truncate">{pageDescription}</div>
           </div>

           <div className="flex items-center gap-3">
             <div className="hidden lg:inline-flex items-center rounded-full border border-white/55 dark:border-white/8 bg-white/45 dark:bg-slate-900/45 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
               Replit Self Use
             </div>
             <button
               onClick={() => setTheme(isDarkMode ? "light" : "dark")}
               className="h-11 w-11 rounded-2xl border border-white/55 dark:border-white/8 bg-white/55 dark:bg-slate-900/50 hover:bg-white/80 dark:hover:bg-slate-900/65 text-muted-foreground hover:text-foreground transition-all flex items-center justify-center shadow-[0_20px_50px_-30px_rgba(15,23,42,0.8)]"
               aria-label="Toggle theme"
             >
               {isDarkMode ? <Sun size={16} className="text-yellow-500" /> : <Moon size={16} className="text-indigo-500" />}
             </button>
           </div>
        </header>
        
        <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6 lg:p-8 relative block">
           <div className="max-w-7xl mx-auto w-full h-full">
             <div className="relative overflow-hidden rounded-[32px] border border-white/60 dark:border-white/8 bg-white/42 dark:bg-slate-950/28 shadow-[0_40px_120px_-60px_rgba(15,23,42,0.85)] backdrop-blur-2xl">
               <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent dark:via-white/20" />
               <div key={location} className="relative w-full h-full animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10 p-4 md:p-6 lg:p-8">
                  {children}
               </div>
             </div>
           </div>
        </main>
      </div>

      {/* Mobile Drawer */}
      <div
        className={cn(
          "fixed inset-0 z-50 md:hidden transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
          mobileMenuOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        aria-hidden={!mobileMenuOpen}
      >
          <div
            className={cn(
              "absolute inset-0 bg-background/72 backdrop-blur-md transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              mobileMenuOpen ? "opacity-100" : "opacity-0",
            )}
            onClick={() => setMobileMenuOpen(false)}
          />
          <div
            className={cn(
              "absolute top-0 bottom-0 left-0 w-72 transform-gpu bg-white/72 dark:bg-slate-950/72 border-r border-white/45 dark:border-white/8 shadow-xl backdrop-blur-2xl transition-transform duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform",
              mobileMenuOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            <div className="h-20 flex items-center justify-between px-4 border-b border-white/40 dark:border-white/8">
              <div>
                <div className="text-[11px] uppercase tracking-[0.24em] text-primary/70">Navigation</div>
                <span className="font-bold text-lg text-foreground">RT Portal</span>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/45 dark:border-white/10 bg-white/45 dark:bg-slate-900/45 text-muted-foreground hover:text-foreground">
                <X size={20} />
              </button>
            </div>
            <div className="py-4 px-3 flex flex-col gap-2">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-3 rounded-2xl transition-colors cursor-pointer text-sm font-medium border",
                    location === item.href
                      ? "border-primary/20 bg-gradient-to-r from-primary/18 via-primary/8 to-transparent text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-white/45 dark:hover:bg-slate-900/40 hover:border-white/45 dark:hover:border-white/8 hover:text-foreground"
                  )}
                >
                  <item.icon size={18} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>
      </div>
    </div>
  )
}
