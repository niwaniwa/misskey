/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Injectable } from '@nestjs/common';
import { isInstanceMuted } from '@/misc/is-instance-muted.js';
import { isUserRelated } from '@/misc/is-user-related.js';
import type { Packed } from '@/misc/json-schema.js';
import { MetaService } from '@/core/MetaService.js';
import { NoteEntityService } from '@/core/entities/NoteEntityService.js';
import { bindThis } from '@/decorators.js';
import { RoleService } from '@/core/RoleService.js';
import { VkemoRelayTimelineService } from '@/core/VkemoRelayTimelineService.js';
import Channel, { type MiChannelService } from '../channel.js';

class VkemoRelayTimelineChannel extends Channel {
	public readonly chName = 'vkemoRelayTimeline';
	public static shouldShare = false;
	public static requireCredential = false as const;
	private withRenotes: boolean;
	private withFiles: boolean;

	constructor(
		private metaService: MetaService,
		private roleService: RoleService,
		private noteEntityService: NoteEntityService,
		private vkemoRelayTimelineService: VkemoRelayTimelineService,

		id: string,
		connection: Channel['connection'],
	) {
		super(id, connection);
	}

	@bindThis
	public async init(params: any) {
		const policies = await this.roleService.getUserPolicies(this.user ? this.user.id : null);
		if (!policies.gtlAvailable) return;

		this.withRenotes = params.withRenotes ?? true;
		this.withFiles = params.withFiles ?? false;

		// Subscribe events
		this.subscriber.on('notesStream', this.onNote);
	}

	@bindThis
	private async onNote(note: Packed<'Note'>) {
		if (this.withFiles && (note.fileIds == null || note.fileIds.length === 0)) return;

		if (note.visibility !== 'public') return;
		if (note.channelId != null) return;

		// 関係ない返信は除外
		if (note.reply && !this.following[note.userId]?.withReplies) {
			const reply = note.reply;
			// 「チャンネル接続主への返信」でもなければ、「チャンネル接続主が行った返信」でもなければ、「投稿者の投稿者自身への返信」でもない場合
			if (reply.userId !== this.user!.id && note.userId !== this.user!.id && reply.userId !== note.userId) return;
		}

		if (note.renote && note.text == null && (note.fileIds == null || note.fileIds.length === 0) && !this.withRenotes) return;

		// Ignore notes from non-vkemo relay
		if (!this.vkemoRelayTimelineService.isRelayedInstance(note.user.host ?? null)) return;
		// Ignore notes from instances the user has muted
		if (isInstanceMuted(note, new Set<string>(this.userProfile?.mutedInstances ?? []))) return;

		// 流れてきたNoteがミュートしているユーザーが関わるものだったら無視する
		if (isUserRelated(note, this.userIdsWhoMeMuting)) return;
		// 流れてきたNoteがブロックされているユーザーが関わるものだったら無視する
		if (isUserRelated(note, this.userIdsWhoBlockingMe)) return;

		if (note.renote && !note.text && isUserRelated(note, this.userIdsWhoMeMutingRenotes)) return;

		if (this.user && note.renoteId && !note.text) {
			if (note.renote && Object.keys(note.renote.reactions).length > 0) {
				const myRenoteReaction = await this.noteEntityService.populateMyReaction(note.renote, this.user.id);
				note.renote.myReaction = myRenoteReaction;
			}
		}

		this.connection.cacheNote(note);

		this.send('note', note);
	}

	@bindThis
	public dispose() {
		// Unsubscribe events
		this.subscriber.off('notesStream', this.onNote);
	}
}

@Injectable()
export class VkemoRelayTimelineChannelService implements MiChannelService<false> {
	public readonly shouldShare = VkemoRelayTimelineChannel.shouldShare;
	public readonly requireCredential = VkemoRelayTimelineChannel.requireCredential;
	public readonly kind = VkemoRelayTimelineChannel.kind;

	constructor(
		private metaService: MetaService,
		private roleService: RoleService,
		private noteEntityService: NoteEntityService,
		private vkemoRelayTimelineService: VkemoRelayTimelineService,
	) {
	}

	@bindThis
	public create(id: string, connection: Channel['connection']): VkemoRelayTimelineChannel {
		return new VkemoRelayTimelineChannel(
			this.metaService,
			this.roleService,
			this.noteEntityService,
			this.vkemoRelayTimelineService,
			id,
			connection,
		);
	}
}