"use client";

import {
  Palette,
  Presentation,
  Lightbulb,
  BriefcaseBusiness,
  Compass,
  Users,
  Megaphone,
  FlaskConical,
  BookOpen,
  Coffee,
  GraduationCap,
  Award,
  Wrench,
  UserPlus,
  CalendarDays,
  Newspaper,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  palette: Palette,
  presentation: Presentation,
  lightbulb: Lightbulb,
  briefcase: BriefcaseBusiness,
  compass: Compass,
  users: Users,
  megaphone: Megaphone,
  flask: FlaskConical,
  "book-open": BookOpen,
  coffee: Coffee,
  "graduation-cap": GraduationCap,
  award: Award,
  wrench: Wrench,
  "user-plus": UserPlus,
  "calendar-days": CalendarDays,
  newspaper: Newspaper,
  "layout-grid": LayoutGrid,
};

export function Icon({
  name,
  className,
  strokeWidth = 2,
}: {
  name: string;
  className?: string;
  strokeWidth?: number;
}) {
  const Cmp = ICONS[name] ?? LayoutGrid;
  return <Cmp className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
}
