"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

import AuthorAvatar from "./AuthorAvatar";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type SelectOption = {
  label: string;
  value: string;
  disabled?: boolean;
  description?: string;
  avatarEmail?: string;
  avatarUrl?: string | null;
  avatarDisplayName?: string | null;
  icon?: ReactNode;
};

type CustomSelectProps = {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  dropdownClassName?: string;
  dropdownAlign?: "start" | "end";
  ariaLabel?: string;
  disabled?: boolean;
  showSearch?: boolean;
};

const DROPDOWN_GAP = 8;
const VIEWPORT_PADDING = 12;
const MAXIMUM_LIST_HEIGHT = 288;
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function firstEnabledIndex(options: SelectOption[], fromEnd = false): number {
  if (fromEnd) {
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (!options[index]?.disabled) return index;
    }
    return -1;
  }

  return options.findIndex((option) => !option.disabled);
}

function adjacentEnabledIndex(
  options: SelectOption[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (options.length === 0) return -1;

  for (let distance = 1; distance <= options.length; distance += 1) {
    const candidate = (currentIndex + direction * distance + options.length) % options.length;
    if (!options[candidate]?.disabled) return candidate;
  }

  return -1;
}

function OptionVisual({ option, size }: { option: SelectOption; size: number }) {
  if (option.icon) {
    return (
      <span aria-hidden="true" className="flex shrink-0 items-center justify-center">
        {option.icon}
      </span>
    );
  }
  if (!option.avatarEmail) return null;

  return (
    <AuthorAvatar
      email={option.avatarEmail}
      displayName={option.avatarDisplayName}
      src={option.avatarUrl}
      size={size}
    />
  );
}

export default function CustomSelect({
  label,
  options,
  value,
  onChange,
  placeholder = "Select an option",
  className,
  triggerClassName,
  dropdownClassName,
  dropdownAlign = "start",
  ariaLabel,
  disabled = false,
  showSearch: forceShowSearch,
}: CustomSelectProps) {
  const generatedId = useId().replaceAll(":", "");
  const listboxId = `custom-select-${generatedId}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const shouldFocusOnOpenRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  const selectedOption = options.find((option) => option.value === value);
  const showSearch = forceShowSearch ?? options.length > 10;
  const filteredOptions = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase("en");
    if (!showSearch || !normalizedSearch) return options;
    return options.filter((option) =>
      [option.label, option.description]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("en")
        .includes(normalizedSearch),
    );
  }, [options, searchTerm, showSearch]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
        setIsOpen(false);
        setSearchTerm("");
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      const dropdown = dropdownRef.current;
      if (!trigger || !dropdown) return;

      const triggerRect = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const availableWidth = Math.max(0, viewportWidth - VIEWPORT_PADDING * 2);

      if (
        triggerRect.bottom < 0 ||
        triggerRect.top > viewportHeight ||
        triggerRect.right < 0 ||
        triggerRect.left > viewportWidth
      ) {
        dropdown.style.visibility = "hidden";
        return;
      }

      dropdown.style.minWidth = `${Math.min(triggerRect.width, availableWidth)}px`;
      dropdown.style.maxWidth = `${availableWidth}px`;
      dropdown.style.maxHeight = "";

      const dropdownWidth = Math.min(
        Math.max(dropdown.offsetWidth, triggerRect.width),
        availableWidth,
      );
      const preferredDropdownHeight = dropdown.offsetHeight;
      const spaceBelow = viewportHeight - triggerRect.bottom - DROPDOWN_GAP - VIEWPORT_PADDING;
      const spaceAbove = triggerRect.top - DROPDOWN_GAP - VIEWPORT_PADDING;
      const openAbove = preferredDropdownHeight > spaceBelow && spaceAbove > spaceBelow;
      const availableHeight = Math.max(0, openAbove ? spaceAbove : spaceBelow);
      dropdown.style.maxHeight = `${Math.floor(availableHeight)}px`;
      const dropdownHeight = Math.min(dropdown.offsetHeight, availableHeight);

      const preferredLeft =
        dropdownAlign === "end" ? triggerRect.right - dropdownWidth : triggerRect.left;
      const maximumLeft = Math.max(
        VIEWPORT_PADDING,
        viewportWidth - dropdownWidth - VIEWPORT_PADDING,
      );
      const left = Math.min(Math.max(preferredLeft, VIEWPORT_PADDING), maximumLeft);

      const preferredTop = openAbove
        ? triggerRect.top - dropdownHeight - DROPDOWN_GAP
        : triggerRect.bottom + DROPDOWN_GAP;
      const maximumTop = Math.max(
        VIEWPORT_PADDING,
        viewportHeight - dropdownHeight - VIEWPORT_PADDING,
      );
      const top = Math.min(Math.max(preferredTop, VIEWPORT_PADDING), maximumTop);

      dropdown.style.left = `${Math.round(left)}px`;
      dropdown.style.top = `${Math.round(top)}px`;
      dropdown.style.visibility = "visible";
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updatePosition);
    if (triggerRef.current) resizeObserver?.observe(triggerRef.current);
    if (dropdownRef.current) resizeObserver?.observe(dropdownRef.current);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      resizeObserver?.disconnect();
    };
  }, [dropdownAlign, filteredOptions.length, isOpen, searchTerm, showSearch]);

  useEffect(() => {
    if (!isOpen || !shouldFocusOnOpenRef.current) return;
    shouldFocusOnOpenRef.current = false;
    if (showSearch) {
      searchRef.current?.focus();
      return;
    }
    optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, isOpen, showSearch]);

  const close = (returnFocus = false) => {
    shouldFocusOnOpenRef.current = false;
    setIsOpen(false);
    setSearchTerm("");
    if (returnFocus) triggerRef.current?.focus();
  };

  const moveFocusFromDropdown = (reverse: boolean) => {
    const trigger = triggerRef.current;
    if (!trigger) {
      close();
      return;
    }

    const focusableElements = Array.from(
      document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter(
      (element) =>
        !dropdownRef.current?.contains(element) &&
        !element.closest('[hidden], [aria-hidden="true"]'),
    );
    const triggerIndex = focusableElements.indexOf(trigger);
    const target =
      triggerIndex < 0 ? null : (focusableElements[triggerIndex + (reverse ? -1 : 1)] ?? null);

    close();
    (target ?? trigger).focus();
  };

  const open = (fromEnd = false) => {
    if (disabled) return;
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(options, fromEnd));
    shouldFocusOnOpenRef.current = true;
    setIsOpen(true);
  };

  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    onChange(option.value);
    close(true);
  };

  const moveOptionFocus = (currentIndex: number, direction: 1 | -1) => {
    const nextIndex = adjacentEnabledIndex(filteredOptions, currentIndex, direction);
    if (nextIndex < 0) return;
    setActiveIndex(nextIndex);
    optionRefs.current[nextIndex]?.focus();
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      open(event.key === "ArrowUp");
    }
  };

  const handleOptionKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    option: SelectOption,
    index: number,
  ) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveOptionFocus(index, event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const nextIndex = firstEnabledIndex(filteredOptions, event.key === "End");
      setActiveIndex(nextIndex);
      optionRefs.current[nextIndex]?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(option);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveFocusFromDropdown(event.shiftKey);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative inline-block min-w-0 text-left", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (isOpen ? close() : open())}
        onKeyDown={handleTriggerKeyDown}
        aria-label={
          ariaLabel
            ? `${ariaLabel}: ${selectedOption?.label ?? placeholder}`
            : label
              ? `${label}: ${selectedOption?.label ?? placeholder}`
              : undefined
        }
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        disabled={disabled}
        className={cn(
          "group flex w-full min-w-0 items-center justify-between gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm font-bold text-[#1B254B] shadow-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60",
          isOpen
            ? "border-primary/50 shadow-[0_12px_30px_-16px_rgba(0,117,201,0.55)]"
            : "border-border hover:border-primary/35",
          triggerClassName,
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {label ? <span className="shrink-0 text-[#718096]">{label}:</span> : null}
          {selectedOption ? <OptionVisual option={selectedOption} size={22} /> : null}
          <span className="truncate">{selectedOption?.label ?? placeholder}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          size={16}
          strokeWidth={2.5}
          className={cn(
            "shrink-0 text-[#A3AED0] transition-transform",
            isOpen && "rotate-180 text-primary",
          )}
        />
      </button>

      {isOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={dropdownRef}
              style={{ visibility: "hidden", width: "max-content" }}
              className={cn(
                "fixed z-[200] flex flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-[0_22px_55px_-18px_rgba(15,23,42,0.28)]",
                dropdownClassName,
              )}
            >
              {showSearch ? (
                <div className="shrink-0 border-b border-border bg-white p-2">
                  <label className="relative block">
                    <span className="sr-only">
                      Search {label?.toLocaleLowerCase("en") ?? "options"}
                    </span>
                    <Search
                      aria-hidden="true"
                      size={15}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-[#718096]"
                    />
                    <input
                      ref={searchRef}
                      type="search"
                      value={searchTerm}
                      onChange={(event) => {
                        const nextSearch = event.target.value;
                        const nextOptions = options.filter((option) =>
                          [option.label, option.description]
                            .filter(Boolean)
                            .join(" ")
                            .toLocaleLowerCase("en")
                            .includes(nextSearch.trim().toLocaleLowerCase("en")),
                        );
                        setSearchTerm(nextSearch);
                        setActiveIndex(firstEnabledIndex(nextOptions));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Tab") {
                          event.preventDefault();
                          moveFocusFromDropdown(event.shiftKey);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          close(true);
                        } else if (event.key === "ArrowDown") {
                          event.preventDefault();
                          const nextIndex = firstEnabledIndex(filteredOptions);
                          setActiveIndex(nextIndex);
                          optionRefs.current[nextIndex]?.focus();
                        }
                      }}
                      placeholder="Search…"
                      className="w-full rounded-xl border border-transparent bg-[#F4F7FE] py-2 pl-9 pr-3 text-sm font-medium text-[#1B254B] outline-none transition-colors placeholder:text-[#718096] focus:border-primary/40"
                    />
                  </label>
                </div>
              ) : null}

              <div
                id={listboxId}
                role="listbox"
                aria-label={ariaLabel ?? label ?? placeholder}
                style={{ maxHeight: MAXIMUM_LIST_HEIGHT }}
                className="min-h-0 flex-1 overflow-y-auto p-1.5"
              >
                {filteredOptions.length ? (
                  filteredOptions.map((option, index) => {
                    const isSelected = option.value === value;
                    return (
                      <button
                        key={option.value}
                        ref={(node) => {
                          optionRefs.current[index] = node;
                        }}
                        id={`${listboxId}-option-${index}`}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        disabled={option.disabled}
                        tabIndex={index === activeIndex ? 0 : -1}
                        onFocus={() => setActiveIndex(index)}
                        onClick={() => choose(option)}
                        onKeyDown={(event) => handleOptionKeyDown(event, option, index)}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50",
                          isSelected
                            ? "bg-primary/8 text-primary"
                            : "text-[#47548C] hover:bg-[#F4F7FE] hover:text-[#1B254B]",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <OptionVisual option={option} size={26} />
                          <span className="min-w-0">
                            <span className="block truncate">{option.label}</span>
                            {option.description ? (
                              <span className="block truncate text-xs font-medium text-[#718096]">
                                {option.description}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        {isSelected ? (
                          <Check
                            aria-hidden="true"
                            size={16}
                            strokeWidth={3}
                            className="shrink-0"
                          />
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <p role="status" className="px-4 py-4 text-center text-sm text-[#718096]">
                    No matching options
                  </p>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
