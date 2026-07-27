import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSIONS_KEY = 'requiredPermissions';

// 传入多个权限时满足任意一个即可，适合“查看自己的任务/查看全部任务”。
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
