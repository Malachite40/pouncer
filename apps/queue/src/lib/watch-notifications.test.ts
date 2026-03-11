import assert from 'node:assert/strict';
import test from 'node:test';
import type { watches } from '@pounce/db/schema';

import { buildTelegramSendMessageBody } from './send-message-body';
import { buildWatchNotifications } from './watch-notifications';

const watchBase: typeof watches.$inferSelect = {
    id: '11111111-1111-1111-1111-111111111111',
    userId: 'user-1',
    url: 'https://example.com/product',
    name: 'Steel & Sons <Monitor>',
    checkType: 'both',
    cssSelector: null,
    elementFingerprint: null,
    imageUrl: null,
    checkIntervalSeconds: 900,
    checkQueuedAt: null,
    checkStartedAt: null,
    checkLeaseExpiresAt: null,
    lastCheckAttemptAt: null,
    lastCheckErrorType: null,
    notifyPriceDrop: true,
    notifyPriceIncrease: true,
    notifyStock: true,
    priceThreshold: null,
    priceDropThreshold: null,
    priceDropPercentThreshold: null,
    priceDropTargetPrice: null,
    priceIncreaseThreshold: null,
    priceIncreasePercentThreshold: null,
    priceIncreaseTargetPrice: null,
    notifyCooldownSeconds: null,
    autoInterval: false,
    baseCheckIntervalSeconds: null,
    lastPrice: '129.99',
    lastStockStatus: 'out_of_stock',
    lastCheckedAt: null,
    lastNotifiedAt: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
};

function getSingleNotification(
    overrides: Partial<typeof watches.$inferSelect>,
    input: { price: number | null; stockStatus: string | null },
) {
    const notifications = buildWatchNotifications({
        watch: { ...watchBase, ...overrides },
        ...input,
    });

    assert.equal(notifications.length, 1);
    return notifications[0];
}

test('builds price drop notification with inline buttons and no HTML link', () => {
    process.env.APP_URL = 'https://app.pounce.test/';

    const notification = getSingleNotification(
        {},
        { price: 89.99, stockStatus: 'out_of_stock' },
    );

    assert.equal(notification.type, 'price_drop');
    assert.ok(
        notification.text.includes('<b>Steel &amp; Sons &lt;Monitor&gt;</b>'),
    );
    assert.ok(!notification.text.includes('<a href='));
    assert.equal(
        notification.replyMarkup?.inline_keyboard[0][0].url,
        'https://example.com/product',
    );
    assert.equal(
        notification.replyMarkup?.inline_keyboard[0][1].url,
        'https://app.pounce.test/watches/11111111-1111-1111-1111-111111111111',
    );
});

test('omits the Pounce deep link when APP_URL is local or non-https', () => {
    process.env.APP_URL = 'http://localhost:3020';

    const notification = getSingleNotification(
        {},
        { price: 89.99, stockStatus: 'out_of_stock' },
    );

    assert.deepEqual(notification.replyMarkup?.inline_keyboard[0], [
        { text: 'View Product', url: 'https://example.com/product' },
    ]);
});

test('builds price drop target notification when the target is crossed', () => {
    const notification = getSingleNotification(
        { priceDropTargetPrice: '99.00' },
        { price: 89.99, stockStatus: 'out_of_stock' },
    );

    assert.equal(notification.type, 'price_drop_target');
    assert.ok(notification.text.includes('Below target price $99.00'));
});

test('builds price increase notification with inline buttons', () => {
    const notification = getSingleNotification(
        { lastPrice: '89.99', lastStockStatus: 'in_stock' },
        { price: 109.99, stockStatus: 'in_stock' },
    );

    assert.equal(notification.type, 'price_increase');
    assert.ok(notification.text.includes('+$20.00'));
    assert.ok(!notification.text.includes('<a href='));
});

test('builds price increase target notification when the target is crossed', () => {
    const notification = getSingleNotification(
        {
            lastPrice: '89.99',
            lastStockStatus: 'in_stock',
            priceIncreaseTargetPrice: '100.00',
        },
        { price: 109.99, stockStatus: 'in_stock' },
    );

    assert.equal(notification.type, 'price_increase_target');
    assert.ok(notification.text.includes('Above target price $100.00'));
});

test('builds back in stock notification with inline buttons', () => {
    const notification = getSingleNotification(
        { lastPrice: null, lastStockStatus: 'out_of_stock' },
        { price: null, stockStatus: 'in_stock' },
    );

    assert.equal(notification.type, 'back_in_stock');
    assert.ok(notification.text.includes('Stock signal recovered.'));
});

test('builds out of stock notification with inline buttons', () => {
    const notification = getSingleNotification(
        { lastPrice: null, lastStockStatus: 'in_stock' },
        { price: null, stockStatus: 'out_of_stock' },
    );

    assert.equal(notification.type, 'out_of_stock');
    assert.ok(notification.text.includes('Stock signal lost.'));
});

test('serializes Telegram send body with reply markup', () => {
    process.env.APP_URL = 'https://app.pounce.test';

    const notification = getSingleNotification(
        {},
        { price: 89.99, stockStatus: 'out_of_stock' },
    );
    const body = buildTelegramSendMessageBody('chat-123', notification);

    assert.equal(body.chat_id, 'chat-123');
    assert.equal(body.parse_mode, 'HTML');
    assert.equal(body.disable_web_page_preview, true);
    assert.deepEqual(body.reply_markup, notification.replyMarkup);
});
