/**
 * Groups Domain Types & Invariants — Stage 4: Membership & Access Operations
 * Represents temporary, intentional social groups with strict role boundaries
 * and capacity-aware access modes.
 */

export type GroupLifetime = '1_day' | '3_days' | '1_week';
export type GroupVisibility = 'private' | 'discoverable';
export type GroupAccessMode = 'open' | 'request' | 'question';
export type GroupRole = 'admin' | 'mod' | 'special' | 'member';
export type GroupMemberStatus = 'active' | 'left' | 'removed';
export type GroupJoinRequestStatus = 'pending' | 'approved' | 'declined' | 'cancelled';
export type GroupLifecycleStatus = 'active' | 'read_only' | 'deleted';

export interface TchatGroup {
  id: string;
  name: string;
  reason: string;
  cover_url: string | null;
  lifetime: GroupLifetime;
  expires_at: string;
  grace_expires_at: string;
  visibility: GroupVisibility;
  access_mode: GroupAccessMode;
  joining_question: string | null;
  max_size: number;
  lifecycle_status: GroupLifecycleStatus;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

export interface TchatGroupMember {
  id?: string;
  group_id: string;
  user_id: string;
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  role: GroupRole;
  status: GroupMemberStatus;
  joined_at: string;
  left_at?: string | null;
  removed_at?: string | null;
  removed_by_id?: string | null;
}

export interface TchatGroupJoinRequest {
  id: string;
  request_id?: string;
  group_id: string;
  user_id: string;
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  question_answer?: string | null;
  status: GroupJoinRequestStatus;
  created_at: string;
  reviewed_at?: string | null;
  reviewed_by_id?: string | null;
}

export interface TchatGroupBan {
  group_id: string;
  user_id: string;
  banned_by_id: string;
  reason?: string | null;
  created_at: string;
}

export interface CreateGroupInput {
  name: string;
  reason: string;
  lifetime: GroupLifetime;
  visibility: GroupVisibility;
  access_mode: GroupAccessMode;
  joiningQuestion?: string;
  maxSize?: number;
  coverUrl?: string;
}

export interface GroupDetails {
  id: string;
  name: string;
  reason: string;
  cover_url: string | null;
  lifetime: GroupLifetime;
  expires_at: string;
  grace_expires_at: string;
  visibility: GroupVisibility;
  access_mode: GroupAccessMode;
  effective_access_mode: GroupAccessMode;
  joining_question: string | null;
  max_size: number;
  lifecycle_status: GroupLifecycleStatus;
  member_count: number;
  admin: {
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
  membership: {
    status: GroupMemberStatus;
    role: GroupRole;
    joined_at: string;
  } | null;
}

export interface GroupServiceResult<T> {
  data: T | null;
  error: string | null;
}

export interface UserActiveGroupItem {
  group_id: string;
  role: GroupRole;
  joined_at: string;
  group: TchatGroup;
}

export type GroupMessageType = 'text' | 'media' | 'system';

export interface GroupMessageSender {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: GroupRole;
}

export interface GroupMessageMedia {
  id: string;
  storage_path: string;
  media_type: 'image' | 'video' | 'audio' | 'file';
  mime_type: string | null;
  file_size_bytes: number | null;
  original_filename: string | null;
  allow_recipient_save: boolean;
  is_saved: boolean;
  expires_at: string;
  is_expired: boolean;
}

export interface GroupMessage {
  id: string;
  group_id: string;
  sender_id: string;
  message_type: GroupMessageType;
  content: string | null;
  media_asset_id: string | null;
  sequence_number: number;
  created_at: string;
  sender?: GroupMessageSender;
  media?: GroupMessageMedia | null;
}

// ------------------------------------------------------------------------------
// Circles Domain Types (Phase 6.5)
// ------------------------------------------------------------------------------

export type CircleLifecycleStatus = 'active' | 'expired' | 'deleted';

export interface TchatCircle {
  id: string;
  group_id: string;
  name: string;
  reason: string | null;
  created_by: string;
  lifecycle_status: CircleLifecycleStatus;
  created_at: string;
  expires_at: string;
  ended_at: string | null;
  member_count: number;
  is_member: boolean;
  is_creator: boolean;
  creator?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url: string | null;
  };
}

export interface CircleMember {
  circle_id: string;
  user_id: string;
  joined_at: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

export interface CircleMessage {
  id: string;
  circle_id: string;
  sender_id: string;
  message_type: GroupMessageType;
  content: string | null;
  media_asset_id: string | null;
  sequence_number: number;
  created_at: string;
  sender_username?: string;
  sender_display_name?: string;
  sender_avatar_url?: string | null;
  media?: GroupMessageMedia | null;
}

export interface CreateCircleInput {
  name: string;
  reason?: string;
}

