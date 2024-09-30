/*
 * SPDX-FileCopyrightText: syuilo and misskey-project
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import { Endpoint } from '@/server/api/endpoint-base.js';
import { IdService } from '@/core/IdService.js';
import type { WebhooksRepository } from '@/models/_.js';
import { webhookEventTypes, WebhookEventType } from '@/models/Webhook.js';
import { GlobalEventService } from '@/core/GlobalEventService.js';
import { DI } from '@/di-symbols.js';
import { RoleService } from '@/core/RoleService.js';
import { ApiError } from '@/server/api/error.js';

// TODO: UserWebhook schemaの適用
export const meta = {
	tags: ['webhooks'],

	requireCredential: true,

	kind: 'write:account',

	errors: {
		tooManyWebhooks: {
			message: 'You cannot create webhook any more.',
			code: 'TOO_MANY_WEBHOOKS',
			id: '87a9bb19-111e-4e37-81d3-a3e7426453b0',
		},
		adminWebhookDenied: {
			message: 'You cannot create webhook for other users.',
			code: 'ADMIN_WEBHOOK_DENIED',
			id: '0d3321b1-6f66-41aa-9fbe-233c60ce19b0',
		},
	},

	res: {
		type: 'object',
		properties: {
			id: {
				type: 'string',
				format: 'misskey:id',
			},
			userId: {
				type: 'string',
				format: 'misskey:id',
			},
			name: { type: 'string' },
			on: {
				type: 'array',
				items: {
					oneOf: [
						{ type: 'string', enum: webhookEventTypes },
						{ type: 'string', pattern: '^note@[a-zA-Z0-9]{1,20}$' },
					],
				},
			},
			url: { type: 'string' },
			secret: { type: 'string' },
			active: { type: 'boolean' },
			latestSentAt: { type: 'string', format: 'date-time', nullable: true },
			latestStatus: { type: 'integer', nullable: true },
		},
	},
} as const;

export const paramDef = {
	type: 'object',
	properties: {
		name: { type: 'string', minLength: 1, maxLength: 100 },
		url: { type: 'string', minLength: 1, maxLength: 1024 },
		secret: { type: 'string', maxLength: 1024, default: '' },
		on: { type: 'array', items: {
			oneOf: [
				{ type: 'string', enum: webhookEventTypes },
				{ type: 'string', pattern: '^note@[a-zA-Z0-9]{1,20}$' },
			],
		} },
	},
	required: ['name', 'url', 'on'],
} as const;

// TODO: ロジックをサービスに切り出す

@Injectable()
export default class extends Endpoint<typeof meta, typeof paramDef> { // eslint-disable-line import/no-default-export
	constructor(
		@Inject(DI.webhooksRepository)
		private webhooksRepository: WebhooksRepository,

		private idService: IdService,
		private globalEventService: GlobalEventService,
		private roleService: RoleService,
	) {
		super(meta, paramDef, async (ps, me) => {
			const currentWebhooksCount = await this.webhooksRepository.countBy({
				userId: me.id,
			});
			if (currentWebhooksCount >= (await this.roleService.getUserPolicies(me.id)).webhookLimit) {
				throw new ApiError(meta.errors.tooManyWebhooks);
			}

			if (ps.on.some(x => !(webhookEventTypes as readonly string[]).includes(x))) {
				if (!await this.roleService.isAdministrator(me)) {
					throw new ApiError(meta.errors.adminWebhookDenied);
				}
			}

			const webhook = await this.webhooksRepository.insertOne({
				id: this.idService.gen(),
				userId: me.id,
				name: ps.name,
				url: ps.url,
				secret: ps.secret,
				on: ps.on as WebhookEventType[],
			});

			this.globalEventService.publishInternalEvent('webhookCreated', webhook);

			return {
				id: webhook.id,
				userId: webhook.userId,
				name: webhook.name,
				on: webhook.on,
				url: webhook.url,
				secret: webhook.secret,
				active: webhook.active,
				latestSentAt: webhook.latestSentAt ? webhook.latestSentAt.toISOString() : null,
				latestStatus: webhook.latestStatus,
			};
		});
	}
}
