"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Box, Boxes, ChevronDown, ClipboardList, Cpu, CreditCard, Film, House, Languages, LayoutDashboard, LayoutTemplate, ListChecks, Network, PackageSearch, PanelTop, ScanLine, ScrollText, Settings2, ShieldCheck, Sparkles, Store, SwatchBook, Tag, UserRound, Users, WandSparkles } from "lucide-react";
import { useI18n } from "@/src/i18n/I18nProvider";
import styles from "./StudioNavigation.module.css";

const groups = [
  { id: "creation", labelKey: "nav.creation", icon: Box, items: [
    { href: "/style-transfer", labelKey: "nav.styleTransfer", icon: SwatchBook },
    { href: "/white-background", labelKey: "nav.whiteBackground", icon: Box },
    { href: "/phone-standardize", labelKey: "nav.phoneStandardize", icon: ScanLine },
    { href: "/sku-variants", labelKey: "nav.skuReplacement", icon: WandSparkles },
    { href: "/pop", labelKey: "nav.pop", icon: PanelTop },
    { href: "/pdp", labelKey: "nav.pdp", icon: LayoutTemplate },
    { href: "/localize", labelKey: "nav.localize", icon: Languages },
    { href: "/product-video", labelKey: "nav.productVideo", icon: Film }
  ] },
  { id: "assets", labelKey: "nav.assets", icon: Network, items: [
    { href: "/assets", labelKey: "nav.assetsLibrary", icon: Boxes },
    { href: "/products", labelKey: "nav.products", icon: PackageSearch }
  ] },
  { id: "brand", labelKey: "nav.brand", icon: Tag, items: [
    { href: "/icon-design", labelKey: "nav.iconDesign", icon: Sparkles }
  ] },
  { id: "system", labelKey: "nav.system", icon: Settings2, items: [
    { href: "/jobs", labelKey: "nav.jobs", icon: ListChecks },
    { href: "/costs", labelKey: "nav.costs", icon: ClipboardList },
    { href: "/marketplace", labelKey: "nav.marketplace", icon: Store },
    { href: "/account/organization", labelKey: "nav.organization", icon: Users },
    { href: "/account", labelKey: "nav.accountSettings", icon: UserRound }
  ] }
];

const adminGroup = {
  id: "admin",
  labelKey: "nav.admin",
  icon: ShieldCheck,
  items: [
    { href: "/admin", labelKey: "nav.adminOverview", icon: LayoutDashboard },
    { href: "/admin/users", labelKey: "nav.adminUsers", icon: Users },
    { href: "/admin/plans", labelKey: "nav.adminPlans", icon: CreditCard },
    { href: "/admin/marketplace", labelKey: "nav.adminMarketplace", icon: Store },
    { href: "/admin/jobs", labelKey: "nav.adminJobs", icon: ClipboardList },
    { href: "/admin/ai", labelKey: "nav.adminAi", icon: Cpu },
    { href: "/admin/audit", labelKey: "nav.adminAudit", icon: ScrollText }
  ]
};

export function StudioNavigation({ className, home = false, isAdmin = false }: { className?: string; home?: boolean; isAdmin?: boolean }) {
  const { t } = useI18n();
  const currentPath = usePathname();
  const pathname = home ? "/studio-home" : currentPath ?? "/studio-home";
  const visibleGroups = isAdmin ? [...groups, adminGroup] : groups;
  const activeGroup = visibleGroups.find(group => group.items.some(item => pathname === item.href || pathname.startsWith(item.href + "/")))?.id;
  const [expanded, setExpanded] = useState<string[]>(activeGroup ? [activeGroup] : []);
  const id = useId();

  useEffect(() => {
    if (activeGroup) setExpanded(current => current.includes(activeGroup) ? current : [...current, activeGroup]);
  }, [activeGroup]);

  return (
    <nav aria-label={t("nav.aria")} className={[styles.navigation, className].filter(Boolean).join(" ")}>
      <Link href="/studio-home" className={styles.item} aria-current={pathname === "/studio-home" ? "page" : undefined}>
        <House size={15} aria-hidden /><span>{t("nav.home")}</span>
      </Link>
      {visibleGroups.map(group => {
        const Icon = group.icon;
        const open = expanded.includes(group.id);
        return <div className={styles.group} key={group.id}>
          <button className={styles.item} aria-expanded={open} aria-controls={`${id}-${group.id}`} onClick={() => setExpanded(current => open ? current.filter(item => item !== group.id) : [...current, group.id])} type="button">
            <Icon size={15} aria-hidden /><span>{t(group.labelKey)}</span><ChevronDown size={12} className={open ? styles.chevronOpen : styles.chevron} aria-hidden />
          </button>
          <div className={styles.children} id={`${id}-${group.id}`} hidden={!open}>
            {group.items.map(item => {
              const ItemIcon = item.icon;
              return <Link className={styles.child} key={item.href} href={item.href} aria-current={pathname === item.href || pathname.startsWith(item.href + "/") ? "page" : undefined}>
                <ItemIcon size={13} aria-hidden /><span>{t(item.labelKey)}</span>
              </Link>;
            })}
          </div>
        </div>;
      })}
    </nav>
  );
}
