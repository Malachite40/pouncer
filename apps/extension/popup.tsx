import { useEffect, useState } from 'react';
import { API_BASE_URL, BRAND, FONTS, RADIUS } from '~lib/constants';
import type { Message } from '~lib/messages';

interface AuthUser {
    id: string;
    name: string;
    email: string;
    image: string | null;
}

function Popup() {
    const [loading, setLoading] = useState(true);
    const [authenticated, setAuthenticated] = useState(false);
    const [user, setUser] = useState<AuthUser | null>(null);

    useEffect(() => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href =
            'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Oswald:wght@500;600;700&display=swap';
        document.head.appendChild(link);
    }, []);

    useEffect(() => {
        chrome.runtime.sendMessage(
            { type: 'AUTH_STATUS_REQUEST' } satisfies Message,
            (response) => {
                setLoading(false);
                if (response?.payload?.authenticated) {
                    setAuthenticated(true);
                    setUser(response.payload.user);
                }
            },
        );
    }, []);

    const handleSelectElement = async () => {
        const [tab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
        });
        if (tab?.id) {
            chrome.tabs.sendMessage(tab.id, {
                type: 'ENABLE_SELECTION',
            } satisfies Message);
            window.close();
        }
    };

    const handleSignOut = () => {
        chrome.runtime.sendMessage(
            { type: 'SIGN_OUT' } satisfies Message,
            () => {
                setAuthenticated(false);
                setUser(null);
            },
        );
    };

    const handleOpenPounce = () => {
        chrome.tabs.create({ url: API_BASE_URL });
    };

    const handleSignIn = () => {
        chrome.tabs.create({ url: `${API_BASE_URL}/login` });
        window.close();
    };

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <div style={styles.logo}>Pounce</div>
                <div style={styles.tagline}>Price Drops + Restocks</div>
            </div>

            {loading ? (
                <div style={styles.status}>Checking auth...</div>
            ) : authenticated && user ? (
                <div style={styles.content}>
                    <div style={styles.userRow}>
                        {user.image ? (
                            <img
                                src={user.image}
                                alt=""
                                style={styles.avatar}
                            />
                        ) : (
                            <div style={styles.avatarPlaceholder}>
                                {user.name?.[0]?.toUpperCase() || '?'}
                            </div>
                        )}
                        <div>
                            <div style={styles.userName}>{user.name}</div>
                            <div style={styles.userEmail}>{user.email}</div>
                        </div>
                    </div>

                    <button
                        type="button"
                        style={styles.primaryBtn}
                        onClick={handleSelectElement}
                    >
                        Select Element
                    </button>

                    <button
                        type="button"
                        style={styles.secondaryBtn}
                        onClick={handleOpenPounce}
                    >
                        Open Pounce
                    </button>

                    <button
                        type="button"
                        style={styles.linkBtn}
                        onClick={handleSignOut}
                    >
                        Sign out
                    </button>
                </div>
            ) : (
                <div style={styles.content}>
                    <div style={styles.status}>
                        Sign in to start tracking prices and stock.
                    </div>
                    <button
                        type="button"
                        style={styles.primaryBtn}
                        onClick={handleSignIn}
                    >
                        Sign in to Pounce
                    </button>
                </div>
            )}

            <div style={styles.footer}>
                <span style={styles.shortcut}>
                    {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}
                    +Shift+P
                </span>
                <span style={styles.footerText}>to select elements</span>
            </div>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    container: {
        width: 300,
        background: BRAND.background,
        color: BRAND.foreground,
        fontFamily: FONTS.sans,
    },
    header: {
        padding: '16px 16px 12px',
        borderBottom: `1px solid ${BRAND.border}`,
    },
    logo: {
        fontSize: 18,
        fontWeight: 700,
        color: BRAND.primary,
        fontFamily: FONTS.display,
        letterSpacing: '-0.04em',
    },
    tagline: {
        fontSize: 10,
        fontWeight: 500,
        color: BRAND.mutedForeground,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        marginTop: 2,
    },
    content: {
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
    },
    userRow: {
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 4,
    },
    avatar: {
        width: 36,
        height: 36,
        borderRadius: '50%',
    },
    avatarPlaceholder: {
        width: 36,
        height: 36,
        borderRadius: '50%',
        background: BRAND.primary,
        color: BRAND.primaryForeground,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 16,
    },
    userName: {
        fontWeight: 600,
        fontSize: 14,
    },
    userEmail: {
        fontSize: 12,
        color: BRAND.mutedForeground,
    },
    status: {
        padding: '12px 16px',
        fontSize: 13,
        color: BRAND.mutedForeground,
        textAlign: 'center',
    },
    primaryBtn: {
        padding: '10px 16px',
        border: 'none',
        borderRadius: RADIUS,
        background: BRAND.primary,
        color: BRAND.primaryForeground,
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        fontFamily: 'inherit',
    },
    secondaryBtn: {
        padding: '10px 16px',
        border: `1px solid ${BRAND.border}`,
        borderRadius: RADIUS,
        background: 'transparent',
        color: BRAND.foreground,
        fontSize: 14,
        cursor: 'pointer',
        fontFamily: 'inherit',
    },
    linkBtn: {
        padding: '6px 16px',
        border: 'none',
        background: 'transparent',
        color: BRAND.mutedForeground,
        fontSize: 12,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'center',
    },
    footer: {
        padding: '10px 16px',
        borderTop: `1px solid ${BRAND.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        justifyContent: 'center',
    },
    shortcut: {
        fontSize: 11,
        fontWeight: 600,
        color: BRAND.primary,
        background: BRAND.primaryLight,
        padding: '2px 6px',
        borderRadius: 4,
    },
    footerText: {
        fontSize: 11,
        color: BRAND.mutedForeground,
    },
};

export default Popup;
