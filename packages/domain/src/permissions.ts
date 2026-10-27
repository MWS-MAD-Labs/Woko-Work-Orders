// What a person may do. Access is a list of these kept per user; the code asks for a permission and nothing else.
export const permissions = [
  "woko.use",
  "work-order.create",
  "work-order.read-all",
  "work-order.operate-any",
  "work-order.transition-any",
  "work-order.approve",
  "work-order.reopen",
  "work-order.cancel",
  "work-order.set-schedule",
  "work-order.manage-participants",
  "work-order.read-audit",
  "work-order.delete",
  "work-order.be-pic",
  "work-order.be-worker",
  "work-order.be-reviewer",
  "work-order.be-overseer",
  "work-list.read",
  "work-list.manage",
  "work-list.be-worker",
  "work-list.receive-digest",
  "facilities.request",
  "facilities.read",
  "facilities.manage",
  "facilities.default-approver",
  "settings.read",
  "settings.manage",
  "users.read",
  "users.manage",
] as const;
export type Permission = (typeof permissions)[number];

// The screen groups them for the person who grants access.
export const permissionGroups: ReadonlyArray<{
  key: string;
  permissions: readonly Permission[];
}> = [
  {
    key: "workOrders",
    permissions: [
      "work-order.create",
      "work-order.read-all",
      "work-order.operate-any",
      "work-order.transition-any",
      "work-order.approve",
      "work-order.reopen",
      "work-order.cancel",
      "work-order.set-schedule",
      "work-order.manage-participants",
      "work-order.read-audit",
      "work-order.delete",
    ],
  },
  {
    key: "participation",
    permissions: [
      "work-order.be-pic",
      "work-order.be-worker",
      "work-order.be-reviewer",
      "work-order.be-overseer",
    ],
  },
  {
    key: "routineWork",
    permissions: [
      "work-list.read",
      "work-list.manage",
      "work-list.be-worker",
      "work-list.receive-digest",
    ],
  },
  {
    key: "facilities",
    permissions: [
      "facilities.request",
      "facilities.read",
      "facilities.manage",
      "facilities.default-approver",
    ],
  },
  {
    key: "administration",
    permissions: [
      "woko.use",
      "settings.read",
      "settings.manage",
      "users.read",
      "users.manage",
    ],
  },
];

const managerPermissions = [
  "woko.use",
  "work-order.create",
  "work-order.read-all",
  "work-order.operate-any",
  "work-order.transition-any",
  "work-order.approve",
  "work-order.reopen",
  "work-order.cancel",
  "work-order.set-schedule",
  "work-order.manage-participants",
  "work-order.read-audit",
  "work-order.be-reviewer",
  "work-list.read",
  "work-list.manage",
  "facilities.request",
  "facilities.read",
  "facilities.manage",
] as const satisfies readonly Permission[];

// Ready-made lists to fill in with one click and to give the first administrator. Nothing is stored under these
// names and no code checks them; a person simply ends up with the permissions in the list.
export const permissionBundles = {
  administrator: [
    ...managerPermissions,
    "work-order.delete",
    "settings.read",
    "settings.manage",
    "users.read",
    "users.manage",
  ],
  facilitiesManager: [
    ...managerPermissions,
    "work-list.receive-digest",
    "facilities.default-approver",
  ],
  personInCharge: [
    "woko.use",
    "work-order.create",
    "work-order.be-pic",
    "facilities.request",
  ],
  worker: [
    "woko.use",
    "work-order.be-worker",
    "work-list.be-worker",
    "facilities.request",
  ],
  overseer: ["woko.use", "work-order.be-overseer", "facilities.request"],
} as const satisfies Record<string, readonly Permission[]>;
export type PermissionBundle = keyof typeof permissionBundles;

export function can(
  granted: readonly Permission[] | undefined,
  permission: Permission,
): boolean {
  return Boolean(granted?.includes(permission));
}

export function canAny(
  granted: readonly Permission[] | undefined,
  wanted: readonly Permission[],
): boolean {
  return wanted.some((permission) => can(granted, permission));
}

export function isPermission(value: unknown): value is Permission {
  return (
    typeof value === "string" &&
    (permissions as readonly string[]).includes(value)
  );
}

// What Woko tells Central about each permission (Access Standard AS-4): a description and what it needs. Everything
// but `woko.use` needs it, and a `manage` needs its `read`.
const descriptions: Record<Permission, string> = {
  "woko.use": "Sign in to Woko",
  "work-order.create": "Create work orders",
  "work-order.read-all": "See every work order and the reports",
  "work-order.operate-any":
    "Post progress, change condition and add evidence on any work order",
  "work-order.transition-any":
    "Move any stage, skip or go back with a reason, reject from review",
  "work-order.approve":
    "Complete work orders and decide vendor and procurement proposals",
  "work-order.reopen": "Reopen a completed work order",
  "work-order.cancel": "Cancel a work order",
  "work-order.set-schedule":
    "Change the priority and the due date of a work order",
  "work-order.manage-participants":
    "Change the people involved in any work order",
  "work-order.read-audit": "See the technical audit history of a work order",
  "work-order.delete": "Delete a work order for good",
  "work-order.be-pic": "Can be assigned as person in charge",
  "work-order.be-worker": "Can be assigned as worker",
  "work-order.be-reviewer": "Can be assigned as reviewer",
  "work-order.be-overseer": "Can be assigned as overseer",
  "work-list.read": "See every Routine Work template and occurrence",
  "work-list.manage":
    "Create and change Routine Work templates and act for the workers",
  "work-list.be-worker": "Can be assigned Routine Work and gets its reminders",
  "work-list.receive-digest":
    "Gets the Routine Work missed-work and weekly digests",
  "facilities.request": "See assets and make or cancel own equipment bookings",
  "facilities.read": "See every equipment booking",
  "facilities.manage": "Manage assets, decide bookings and inspect returns",
  "facilities.default-approver":
    "First choice to approve new equipment bookings",
  "settings.read": "See locations and work settings",
  "settings.manage": "Change locations and work settings, retry failed emails",
  "users.read": "See the list of users and what they may do",
  "users.manage": "Register people and change what they may do",
};

const needs: Partial<Record<Permission, readonly Permission[]>> = {
  "work-list.manage": ["work-list.read"],
  "facilities.manage": ["facilities.read"],
  "settings.manage": ["settings.read"],
  "users.manage": ["users.read"],
};

export interface PermissionManifestEntry {
  key: Permission;
  description: string;
  requires?: Permission[];
}

export const permissionManifest: readonly PermissionManifestEntry[] =
  permissions.map((key) => {
    const requires =
      key === "woko.use"
        ? []
        : ["woko.use" as Permission, ...(needs[key] ?? [])];
    return requires.length
      ? { key, description: descriptions[key], requires }
      : { key, description: descriptions[key] };
  });

// The starting roles for Central (`role-presets.json`, made by `npm run presets:write`), one per bundle.
export const rolePresets = [
  { bundle: "administrator", key: "ADMINISTRATOR", label: "Administrator" },
  {
    bundle: "facilitiesManager",
    key: "FACILITIES_MANAGER",
    label: "Facilities Manager",
  },
  {
    bundle: "personInCharge",
    key: "PERSON_IN_CHARGE",
    label: "Person in Charge",
  },
  { bundle: "worker", key: "WORKER", label: "Worker" },
  { bundle: "overseer", key: "OVERSEER", label: "Overseer" },
] as const satisfies ReadonlyArray<{
  bundle: PermissionBundle;
  key: string;
  label: string;
}>;

export function rolePresetsFile() {
  return {
    application_id: "woko",
    roles: rolePresets.map((preset) => ({
      key: preset.key,
      label: preset.label,
      permissions: [...permissionBundles[preset.bundle]],
      allows_employees: true,
      allows_students: false,
      allows_interns: false,
    })),
  };
}

const requiresByKey = new Map<Permission, readonly Permission[]>(
  permissionManifest.map((entry) => [entry.key, entry.requires ?? []]),
);

// Pairs of [permission, what it needs] that a list leaves out. Central refuses such a role, and so does Woko.
export function missingRequirements(
  list: readonly Permission[],
): Array<[Permission, Permission]> {
  const held = new Set(list);
  return [...held].flatMap((key) =>
    (requiresByKey.get(key) ?? [])
      .filter((needed) => !held.has(needed))
      .map((needed): [Permission, Permission] => [key, needed]),
  );
}

// Ticking a permission also ticks what it needs.
export function withRequirements(
  list: readonly Permission[],
  key: Permission,
): Permission[] {
  const next = new Set<Permission>([...list, key]);
  const queue = [key];
  while (queue.length)
    for (const needed of requiresByKey.get(queue.shift() as Permission) ?? [])
      if (!next.has(needed)) (next.add(needed), queue.push(needed));
  return permissions.filter((candidate) => next.has(candidate));
}

// Unticking a permission also unticks what needs it.
export function withoutDependents(
  list: readonly Permission[],
  key: Permission,
): Permission[] {
  const gone = new Set<Permission>([key]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const candidate of list)
      if (
        !gone.has(candidate) &&
        (requiresByKey.get(candidate) ?? []).some((needed) => gone.has(needed))
      )
        (gone.add(candidate), (changed = true));
  }
  return list.filter((candidate) => !gone.has(candidate));
}
