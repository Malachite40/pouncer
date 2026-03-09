export type Message =
    | { type: 'ENABLE_SELECTION' }
    | { type: 'DISABLE_SELECTION' }
    | {
          type: 'ELEMENT_SELECTED';
          payload: {
              url: string;
              cssSelector: string;
              name: string;
              checkType: 'price' | 'stock' | 'both';
              imageUrl: string | null;
              skipMerge: boolean;
          };
      }
    | { type: 'WATCH_CREATED'; payload: { id: string; name: string; merged: boolean } }
    | { type: 'WATCH_FAILED'; payload: { error: string; authRequired?: boolean } }
    | { type: 'CHECK_EXISTING_WATCH'; payload: { url: string } }
    | { type: 'EXISTING_WATCH_RESULT'; payload: { id: string; name: string; checkType: string } | null }
    | { type: 'AUTH_STATUS_REQUEST' }
    | {
          type: 'AUTH_STATUS';
          payload:
              | {
                    authenticated: true;
                    user: { id: string; name: string; email: string; image: string | null };
                }
              | { authenticated: false };
      }
    | { type: 'SIGN_OUT' };
