import { Input } from "@/components/ui/input";
import { type SkillCategory, skillCategories } from "@/lib/skills-data";
import { cn } from "@/lib/utils";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";

interface SkillsFilterBarProps {
  activeCategories: SkillCategory[];
  onCategoryToggle: (category: SkillCategory) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  searchPlaceholder?: string;
}

export function SkillsFilterBar({
  activeCategories,
  onCategoryToggle,
  searchQuery,
  onSearchChange,
  searchPlaceholder = "Search...",
}: SkillsFilterBarProps) {
  return (
    <div className="mt-4 flex items-center gap-2">
      {skillCategories.map((cat) => {
        const isSelected = activeCategories.includes(cat.value);
        return (
          <button
            key={cat.value}
            type="button"
            onClick={() => onCategoryToggle(cat.value)}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
              isSelected
                ? "border border-border bg-muted text-foreground"
                : "border border-border/50 text-muted-foreground hover:bg-accent",
            )}
          >
            {cat.label}
          </button>
        );
      })}

      <div className="relative ml-2 min-w-[120px] flex-1">
        <MagnifyingGlassIcon
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60"
          size={13}
        />
        <Input
          placeholder={searchPlaceholder}
          className="h-8 rounded-[6px] bg-transparent pl-8 text-sm"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}
