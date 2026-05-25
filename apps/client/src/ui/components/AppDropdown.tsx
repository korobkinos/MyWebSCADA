import { Menu, MenuItem, Popover, Position } from "@blueprintjs/core";
import type { ComponentProps, ReactNode } from "react";

export type AppDropdownItem = {
  id: string;
  text: string;
  disabled?: boolean;
  icon?: ReactNode;
  onClick?: () => void;
};

export type AppDropdownMenuProps = {
  trigger: ReactNode;
  items: AppDropdownItem[];
  className?: string;
};

export function AppDropdown({ trigger, items, className }: AppDropdownMenuProps) {
  return (
    <Popover
      content={(
        <Menu className="app-dropdown-menu">
          {items.map((item) => (
            <MenuItem
              key={item.id}
              text={item.text}
              icon={item.icon as ComponentProps<typeof MenuItem>["icon"]}
              disabled={item.disabled}
              onClick={item.onClick}
            />
          ))}
        </Menu>
      )}
      position={Position.BOTTOM_LEFT}
      minimal
      className={className}
    >
      <span className="app-dropdown-trigger">{trigger}</span>
    </Popover>
  );
}
