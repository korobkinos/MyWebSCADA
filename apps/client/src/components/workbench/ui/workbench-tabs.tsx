import { AppTabs, type AppTabItem } from "../../../ui";

export type WorkbenchTabItem = AppTabItem;

type WorkbenchTabsProps = {
  items: WorkbenchTabItem[];
  className?: string;
};

export function WorkbenchTabs({ items, className }: WorkbenchTabsProps) {
  return <AppTabs items={items} className={className} />;
}
