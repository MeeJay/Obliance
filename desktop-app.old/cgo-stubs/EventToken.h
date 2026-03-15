// EventToken.h — minimal stub so webview_go compiles without a full Windows SDK.
// EventRegistrationToken is defined here exactly as in the real Windows SDK header.
#pragma once
#ifndef __EventToken_DEFINED__
#define __EventToken_DEFINED__

typedef struct EventRegistrationToken {
    __int64 value;
} EventRegistrationToken;

#endif // __EventToken_DEFINED__
