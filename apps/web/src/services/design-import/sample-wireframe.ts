import type { DesignImportDocument, DesignImportNode } from './design-import-types';

/**
 * Hand-authored greyscale wireframe for a "Tasks" index screen. Used to
 * validate the JSON-to-PenNode importer end-to-end: outer screen frame,
 * sidebar with workspace + nav, main area with header / tab bar / task rows.
 *
 * Palette intentionally restricted to greys: #fafafa #ffffff #f3f4f6 #e5e7eb
 *                                            #111827 #6b7280
 * Type ramp: title 24/600, body 14/500, caption 12/400.
 */

const COLOR_BG = '#fafafa';
const COLOR_SURFACE = '#ffffff';
const COLOR_SURFACE_2 = '#f3f4f6';
const COLOR_BORDER = '#e5e7eb';
const COLOR_TEXT = '#111827';
const COLOR_MUTED = '#6b7280';

interface TaskRow {
  title: string;
  priority: 'High' | 'Med' | 'Low';
  date: string;
}

const TASKS: TaskRow[] = [
  { title: 'Wire JSON import into the canvas', priority: 'High', date: 'Jun 3' },
  { title: 'Write mapper unit tests', priority: 'High', date: 'Jun 3' },
  { title: 'Greyscale palette audit', priority: 'Med', date: 'Jun 4' },
  { title: 'Type ramp sanity pass', priority: 'Med', date: 'Jun 5' },
  { title: 'Ship dev affordance button', priority: 'Low', date: 'Jun 6' },
];

const NAV_ITEMS = ['Inbox', 'Today', 'Upcoming', 'Archive'];

function navItem(label: string, active: boolean): DesignImportNode {
  return {
    type: 'frame',
    name: `Nav · ${label}`,
    w: 208,
    h: 32,
    radius: 6,
    bg: active ? COLOR_SURFACE_2 : COLOR_SURFACE,
    padX: 12,
    padY: 8,
    flex: 'row',
    gap: 8,
    children: [
      {
        type: 'text',
        name: 'Label',
        text: label,
        fontSize: 14,
        fontWeight: active ? 600 : 500,
        color: active ? COLOR_TEXT : COLOR_MUTED,
      },
    ],
  };
}

function priorityBadge(level: TaskRow['priority']): DesignImportNode {
  return {
    type: 'frame',
    name: `Badge · ${level}`,
    w: 56,
    h: 22,
    radius: 11,
    bg: COLOR_SURFACE_2,
    padX: 10,
    padY: 4,
    flex: 'row',
    gap: 4,
    children: [
      {
        type: 'text',
        name: 'Label',
        text: level,
        fontSize: 12,
        fontWeight: 500,
        color: COLOR_MUTED,
      },
    ],
  };
}

function taskRow(task: TaskRow): DesignImportNode {
  return {
    type: 'frame',
    name: `Task · ${task.title}`,
    w: 920,
    h: 56,
    radius: 8,
    bg: COLOR_SURFACE,
    padX: 20,
    padY: 16,
    flex: 'row',
    gap: 16,
    children: [
      {
        type: 'ellipse',
        name: 'Checkbox',
        w: 18,
        h: 18,
        bg: COLOR_SURFACE,
        radius: 9,
      },
      {
        type: 'text',
        name: 'Title',
        text: task.title,
        w: 640,
        fontSize: 14,
        fontWeight: 500,
        color: COLOR_TEXT,
      },
      priorityBadge(task.priority),
      {
        type: 'text',
        name: 'Date',
        text: task.date,
        w: 80,
        fontSize: 12,
        fontWeight: 400,
        color: COLOR_MUTED,
      },
    ],
  };
}

const SIDEBAR: DesignImportNode = {
  type: 'frame',
  name: 'Sidebar',
  x: 0,
  y: 0,
  w: 240,
  h: 820,
  bg: COLOR_SURFACE,
  padX: 16,
  padY: 24,
  flex: 'col',
  gap: 20,
  children: [
    {
      type: 'frame',
      name: 'Workspace',
      w: 208,
      h: 48,
      bg: COLOR_SURFACE,
      flex: 'row',
      gap: 12,
      padX: 4,
      padY: 4,
      children: [
        {
          type: 'rectangle',
          name: 'Avatar',
          w: 36,
          h: 36,
          radius: 8,
          bg: COLOR_SURFACE_2,
        },
        {
          type: 'frame',
          name: 'Workspace meta',
          w: 156,
          h: 36,
          bg: COLOR_SURFACE,
          flex: 'col',
          gap: 2,
          children: [
            {
              type: 'text',
              name: 'Workspace name',
              text: 'OpenPencil',
              fontSize: 14,
              fontWeight: 600,
              color: COLOR_TEXT,
            },
            {
              type: 'text',
              name: 'Workspace plan',
              text: 'Personal · Free',
              fontSize: 12,
              fontWeight: 400,
              color: COLOR_MUTED,
            },
          ],
        },
      ],
    },
    {
      type: 'frame',
      name: 'Nav',
      w: 208,
      h: 160,
      bg: COLOR_SURFACE,
      flex: 'col',
      gap: 4,
      children: NAV_ITEMS.map((label, i) => navItem(label, i === 1)),
    },
  ],
};

const HEADER: DesignImportNode = {
  type: 'frame',
  name: 'Header',
  w: 1000,
  h: 56,
  bg: COLOR_BG,
  flex: 'row',
  gap: 16,
  padX: 0,
  padY: 0,
  children: [
    {
      type: 'text',
      name: 'Title',
      text: 'Tasks',
      w: 760,
      fontSize: 24,
      fontWeight: 600,
      color: COLOR_TEXT,
    },
    {
      type: 'frame',
      name: 'Add task',
      w: 120,
      h: 36,
      radius: 8,
      bg: COLOR_TEXT,
      padX: 14,
      padY: 8,
      flex: 'row',
      gap: 6,
      children: [
        {
          type: 'text',
          name: 'Label',
          text: '+ Add task',
          fontSize: 14,
          fontWeight: 500,
          color: COLOR_SURFACE,
        },
      ],
    },
  ],
};

const TAB_BAR: DesignImportNode = {
  type: 'frame',
  name: 'Tabs',
  w: 1000,
  h: 40,
  bg: COLOR_BG,
  flex: 'row',
  gap: 24,
  padX: 0,
  padY: 8,
  children: [
    {
      type: 'text',
      name: 'Tab · Today',
      text: 'Today',
      fontSize: 14,
      fontWeight: 600,
      color: COLOR_TEXT,
    },
    {
      type: 'text',
      name: 'Tab · Week',
      text: 'This week',
      fontSize: 14,
      fontWeight: 500,
      color: COLOR_MUTED,
    },
    {
      type: 'text',
      name: 'Tab · All',
      text: 'All',
      fontSize: 14,
      fontWeight: 500,
      color: COLOR_MUTED,
    },
  ],
};

const MAIN: DesignImportNode = {
  type: 'frame',
  name: 'Main',
  x: 240,
  y: 0,
  w: 1040,
  h: 820,
  bg: COLOR_BG,
  padX: 40,
  padY: 32,
  flex: 'col',
  gap: 16,
  children: [
    HEADER,
    TAB_BAR,
    {
      type: 'frame',
      name: 'Task list',
      w: 960,
      h: 320,
      bg: COLOR_BG,
      flex: 'col',
      gap: 8,
      children: TASKS.map(taskRow),
    },
  ],
};

export const SAMPLE_TASKS_INDEX: DesignImportDocument = {
  name: 'Tasks index — sample wireframe',
  nodes: [
    {
      type: 'frame',
      name: 'Tasks · Screen',
      x: 0,
      y: 0,
      w: 1280,
      h: 820,
      bg: COLOR_BG,
      radius: 12,
      // The screen itself uses absolute positioning so the sidebar/main split
      // sits where the author placed them; no flex on the outer container.
      children: [
        SIDEBAR,
        {
          type: 'rectangle',
          name: 'Divider',
          x: 240,
          y: 0,
          w: 1,
          h: 820,
          bg: COLOR_BORDER,
        },
        MAIN,
      ],
    },
  ],
};
