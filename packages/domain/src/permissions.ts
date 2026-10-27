import { can, canAny, definePermissions } from "mws-central-auth/access";

// What a person may do. Access is a list of these kept per user; the code asks for a permission and nothing else.
// The list is checked when this module loads (Access Standard AS-3, AS-4): key format, `woko.use`, every `manage`
// needing its `read`, and everything else needing `woko.use`.
export const wokoPermissions = definePermissions({
  application: "woko",
  permissions: [
    { key: "woko.use", description: "Sign in to Woko" },
    { key: "work-order.create", description: "Create work orders", requires: ["woko.use"] },
    { key: "work-order.read-all", description: "See every work order and the reports", requires: ["woko.use"] },
    { key: "work-order.operate-any", description: "Post progress, change condition and add evidence on any work order", requires: ["woko.use"] },
    { key: "work-order.transition-any", description: "Move any stage, skip or go back with a reason, reject from review", requires: ["woko.use"] },
    { key: "work-order.approve", description: "Complete work orders and decide vendor and procurement proposals", requires: ["woko.use"] },
    { key: "work-order.reopen", description: "Reopen a completed work order", requires: ["woko.use"] },
    { key: "work-order.cancel", description: "Cancel a work order", requires: ["woko.use"] },
    { key: "work-order.set-schedule", description: "Change the priority and the due date of a work order", requires: ["woko.use"] },
    { key: "work-order.manage-participants", description: "Change the people involved in any work order", requires: ["woko.use"] },
    { key: "work-order.read-audit", description: "See the technical audit history of a work order", requires: ["woko.use"] },
    { key: "work-order.delete", description: "Delete a work order for good", requires: ["woko.use"] },
    { key: "work-order.be-pic", description: "Can be assigned as person in charge", requires: ["woko.use"] },
    { key: "work-order.be-worker", description: "Can be assigned as worker", requires: ["woko.use"] },
    { key: "work-order.be-reviewer", description: "Can be assigned as reviewer", requires: ["woko.use"] },
    { key: "work-order.be-overseer", description: "Can be assigned as overseer", requires: ["woko.use"] },
    { key: "work-list.read", description: "See every Routine Work template and occurrence", requires: ["woko.use"] },
    { key: "work-list.manage", description: "Create and change Routine Work templates and act for the workers", requires: ["woko.use", "work-list.read"] },
    { key: "work-list.be-worker", description: "Can be assigned Routine Work and gets its reminders", requires: ["woko.use"] },
    { key: "work-list.receive-digest", description: "Gets the Routine Work missed-work and weekly digests", requires: ["woko.use"] },
    { key: "facilities.request", description: "See assets and make or cancel own equipment bookings", requires: ["woko.use"] },
    { key: "facilities.read", description: "See every equipment booking", requires: ["woko.use"] },
    { key: "facilities.manage", description: "Manage assets, decide bookings and inspect returns", requires: ["woko.use", "facilities.read"] },
    { key: "facilities.default-approver", description: "First choice to approve new equipment bookings", requires: ["woko.use"] },
    { key: "settings.read", description: "See locations and work settings", requires: ["woko.use"] },
    { key: "settings.manage", description: "Change locations and work settings, retry failed emails", requires: ["woko.use", "settings.read"] },
    { key: "users.read", description: "See the list of users and what they may do", requires: ["woko.use"] },
    { key: "users.manage", description: "Register people and change what they may do", requires: ["woko.use", "users.read"] },
  ],
} as const);

export const permissions = wokoPermissions.keys;
export type Permission = (typeof permissions)[number];

export { can, canAny };

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

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && wokoPermissions.has(value);
}

export type PermissionManifestEntry = (typeof wokoPermissions.manifest)[number];

// What Woko tells Central about each permission (Access Standard AS-4): a description and what it needs.
export const permissionManifest = wokoPermissions.manifest;

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
  permissionManifest.map((entry) => [
    entry.key as Permission,
    (entry.requires ?? []) as Permission[],
  ]),
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
