import type { FastifyBaseLogger } from 'fastify';
import { config } from './config.js';
import { sql } from './database/client.js';
import { deleteDriveFolderPermission } from './drive.js';

type LegacyPermission = {
  work_order_id: string;
  user_id: string;
  drive_folder_id: string;
  permission_id: string;
};

export async function revokeLegacyWorkOrderFolderPermissions(logger: FastifyBaseLogger): Promise<void> {
  if (!config.GOOGLE_APPLICATION_CREDENTIALS) return;
  const permissions = await sql<LegacyPermission[]>`
    select permission.work_order_id, permission.user_id, work_order.drive_folder_id, permission.permission_id
    from work_order_drive_permissions permission
    join work_orders work_order on work_order.id = permission.work_order_id
    where permission.permission_id is not null
      and permission.sync_status <> 'REMOVED'
      and work_order.drive_folder_id is not null
    order by permission.updated_at
  `;

  for (const permission of permissions) {
    try {
      await deleteDriveFolderPermission(permission.drive_folder_id, permission.permission_id);
      await sql`
        update work_order_drive_permissions
        set permission_id = null, sync_status = 'REMOVED', last_error = null, updated_at = now()
        where work_order_id = ${permission.work_order_id} and user_id = ${permission.user_id}
      `;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 2000) : 'Legacy Drive permission removal failed.';
      await sql`
        update work_order_drive_permissions
        set sync_status = 'FAILED', last_error = ${message}, updated_at = now()
        where work_order_id = ${permission.work_order_id} and user_id = ${permission.user_id}
      `;
      logger.error({ error, workOrderId: permission.work_order_id, userId: permission.user_id }, 'Failed to revoke legacy work-order Drive permission');
    }
  }

  if (permissions.length) logger.info({ count: permissions.length }, 'Processed legacy work-order Drive permissions');
}
