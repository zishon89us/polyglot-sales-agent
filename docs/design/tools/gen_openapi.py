"""Builds docs/design/openapi.yaml for the design phase.

Used once to write the design-time contract without repeating boilerplate by
hand. From milestone M2 the file is generated from the Fastify route schemas
(ADR 0002) and this script is retired.
"""
import sys
import yaml

OUT = sys.argv[1]

def ref(n):
    return {"$ref": f"#/components/schemas/{n}"}

def arr(item):
    return {"type": "array", "items": item}

def obj(props, required=None, desc=None):
    o = {"type": "object", "properties": props, "additionalProperties": False}
    if required:
        o["required"] = required
    if desc:
        o["description"] = desc
    return o

S = {"type": "string"}
UUID = {"type": "string", "format": "uuid"}
TIME = {"type": "string", "format": "date-time", "description": "RFC 3339, in UTC."}
INT = {"type": "integer"}
BOOL = {"type": "boolean"}

def enum(*v):
    return {"type": "string", "enum": list(v)}

def nullable(s):
    return {"anyOf": [s, {"type": "null"}]}

HOURS = arr(obj({"weekday": {"type": "integer", "minimum": 1, "maximum": 7, "description": "1 is Monday."},
                 "opens": {"type": "string", "pattern": "^[0-2][0-9]:[0-5][0-9]$"},
                 "closes": {"type": "string", "pattern": "^[0-2][0-9]:[0-5][0-9]$"}},
                ["weekday", "opens", "closes"]))

schemas = {
    "Problem": obj({
        "type": {"type": "string", "description": "A URI naming the problem type."},
        "title": S, "status": INT, "detail": S,
        "code": {"type": "string", "description": "A stable code from the table in api.md."},
        "errors": arr(obj({"field": S, "message": S, "allowed": S}, ["field", "message"])),
    }, ["type", "title", "status", "code"], "An error, in the shape of RFC 9457 problem details."),
    "SignIn": obj({"email": {"type": "string", "format": "email"}, "password": {"type": "string", "maxLength": 1024}},
                  ["email", "password"]),
    "Session": obj({"user": ref("User"), "tenant_id": UUID, "csrf_token": S, "expires_at": TIME},
                   ["user", "tenant_id", "csrf_token", "expires_at"]),
    "TokenPassword": obj({"token": S, "password": {"type": "string", "minLength": 12, "maxLength": 1024}},
                         ["token", "password"]),
    "PasswordChange": obj({"current_password": S, "new_password": {"type": "string", "minLength": 12, "maxLength": 1024}},
                          ["current_password", "new_password"]),
    "EmailOnly": obj({"email": {"type": "string", "format": "email"}}, ["email"]),
    "User": obj({"id": UUID, "email": {"type": "string", "format": "email"}, "role": enum("owner", "agent"),
                 "status": enum("invited", "active", "removed")}, ["id", "email", "role", "status"]),
    "UserInvite": obj({"email": {"type": "string", "format": "email"}, "role": enum("owner", "agent")}, ["email", "role"]),
    "UserRole": obj({"role": enum("owner", "agent")}, ["role"]),
    "Tenant": obj({
        "id": UUID, "name": S, "pack": enum("booking", "faq-only"),
        "answering": BOOL,
        "missing": arr({"type": "string", "description": "A required setting or check that is not yet satisfied."}),
        "settings": ref("Settings")}, ["id", "name", "pack", "answering", "missing", "settings"]),
    "Settings": obj({
        "name": S,
        "time_zone": {"type": "string", "description": "IANA time zone."},
        "default_language": S,
        "template_languages": arr(enum("ar", "en")),
        "currency": {"type": "string", "pattern": "^[A-Z]{3}$"},
        "support_contact": S,
        "notification_email": {"type": "string", "format": "email"},
        "business_hours": HOURS,
        "pack_settings": {"type": "object", "additionalProperties": True,
                          "description": "The settings the tenant's pack declares, validated by the server against the pack's schema. For the booking pack: booking_horizon_days (7 to 365), slot_interval_minutes (5 to 120), total_concurrent_bookings (1 to 50, or null), minimum_notice_minutes (0 to 4320), change_cutoff_minutes (0 to 4320), reminder_lead_minutes (60 to 4320). Empty for a pack with no settings."},
        "quiet_hours": nullable(obj({"start": S, "end": S}, ["start", "end"])),
        "handover_escalation_minutes": {"type": "integer", "minimum": 5, "maximum": 240},
        "message_retention_months": {"type": "integer", "minimum": 1, "maximum": 36},
    }, None, "The tenant settings of the glossary. A PATCH may send any subset."),
    "SettingsResult": obj({"settings": ref("Settings"), "warnings": arr(S)}, ["settings", "warnings"]),
    "ChannelCredentials": obj({"phone_number_id": S, "business_account_id": S,
                               "access_token": {"type": "string", "writeOnly": True}},
                              ["phone_number_id", "business_account_id", "access_token"]),
    "ChannelStatus": obj({"connected": BOOL, "phone_number_id": nullable(S),
                          "token_hint": nullable({"type": "string", "description": "The last four characters only."}),
                          "last_checked_at": nullable(TIME),
                          "last_error": nullable({"type": "string", "description": "A sanitised code, never the channel's raw message."})},
                         ["connected"]),
    "Template": obj({"name": S, "language": S, "status": enum("not-submitted", "pending", "approved", "rejected", "paused", "disabled"),
                     "updated_at": TIME}, ["name", "language", "status"]),
    "Service": obj({"id": UUID, "name": S, "description": S, "price_minor": {"type": "integer", "minimum": 0},
                    "active": BOOL, "updated_at": TIME},
                   ["id", "name", "price_minor", "active", "updated_at"]),
    "BookingServiceSettings": obj({"service_id": UUID,
                                   "duration_minutes": {"type": "integer", "minimum": 5, "maximum": 480},
                                   "capacity": {"type": "integer", "minimum": 1, "maximum": 50}, "updated_at": TIME},
                                  ["duration_minutes", "capacity"], "Booking pack. A service with no settings cannot be booked."),
    "ServiceInput": obj({"name": {"type": "string", "minLength": 1, "maxLength": 200}, "description": {"type": "string", "maxLength": 2000},
                         "price_minor": {"type": "integer", "minimum": 0}, "active": BOOL},
                        ["name", "price_minor"]),
    "OpeningHours": obj({"periods": HOURS, "updated_at": TIME}, ["periods"]),
    "OpeningHoursResult": obj({"periods": HOURS, "updated_at": TIME, "warnings": arr(S)}, ["periods", "warnings"]),
    "Policy": obj({"id": UUID, "title": S, "body": S, "updated_at": TIME}, ["id", "title", "body", "updated_at"]),
    "PolicyInput": obj({"title": {"type": "string", "minLength": 1, "maxLength": 200},
                        "body": {"type": "string", "minLength": 1, "maxLength": 4000}}, ["title", "body"]),
    "BlockedPeriod": obj({"id": UUID, "starts_at": TIME, "ends_at": TIME}, ["id", "starts_at", "ends_at"]),
    "BlockedPeriodInput": obj({"starts_at": TIME, "ends_at": TIME,
                               "keep_bookings": {"type": "boolean", "description": "Must be true to block a period that contains bookings."}},
                              ["starts_at", "ends_at"]),
    "Contact": obj({"id": UUID, "phone": S, "profile_name": nullable(S), "language": nullable(S),
                    "opted_out": BOOL, "consent": enum("none", "recorded")}, ["id", "phone", "opted_out", "consent"]),
    "ContactSearch": obj({"phone": {"type": "string", "description": "In international format."}}, ["phone"]),
    "Conversation": obj({
        "id": UUID, "contact": ref("Contact"), "last_message_at": nullable(TIME),
        "reply_window_open": BOOL,
        "session_state": enum("none", "active", "handed-over"),
        "handover": nullable(ref("Handover"))},
        ["id", "contact", "reply_window_open", "session_state"]),
    "Message": obj({
        "id": UUID, "direction": enum("inbound", "outbound"),
        "class": nullable(enum("assistant-reply", "system-reply", "staff-message", "service-notice", "business-initiated")),
        "type": {"type": "string", "description": "text, button, or the unsupported type's name."},
        "text": nullable({"type": "string", "description": "Untrusted. Render as characters, never as markup."}),
        "status": nullable(enum("pending", "held", "discarded", "withheld", "sending", "sent", "delivered", "read", "failed")),
        "status_reason": nullable(S), "sent_by_user_id": nullable(UUID), "created_at": TIME},
        ["id", "direction", "type", "created_at"]),
    "StaffMessageInput": obj({"text": {"type": "string", "minLength": 1, "maxLength": 4000}}, ["text"]),
    "Handover": obj({
        "id": UUID, "conversation_id": UUID,
        "state": enum("waiting", "in-progress", "detached", "followed-up", "handed-back", "answered", "closed-unanswered"),
        "urgent": {"type": "boolean", "description": "True once the reason emergency is present. Urgent handovers are listed first."},
        "reasons": arr(enum("requested", "repeated-failure", "sensitive-topic", "data-request", "emergency", "limit",
                            "unsupported-content", "late-change", "provider-failure", "staff")),
        "held_by_user_id": nullable(UUID), "overdue": BOOL,
        "followup_status": nullable(enum("available", "held", "sent", "withheld", "failed")),
        "closed_reason": nullable(S), "opened_at": TIME}, ["id", "conversation_id", "state", "reasons", "urgent", "overdue", "opened_at"]),
    "HandoverClose": obj({"reason": {"type": "string", "minLength": 1, "maxLength": 200}}, ["reason"]),
    "Booking": obj({
        "id": UUID, "service_id": UUID, "contact_id": nullable(UUID), "starts_at": TIME, "ends_at": TIME,
        "state": enum("booked", "confirmed", "cancelled", "attended", "missed"),
        "created_via": enum("chat", "staff")}, ["id", "service_id", "starts_at", "ends_at", "state", "created_via"]),
    "BookingInput": obj({"service_id": UUID, "starts_at": TIME, "contact_id": nullable(UUID),
                         "contact_phone": nullable({"type": "string", "description": "In international format. Finds or creates the contact. Use this or contact_id, not both."}),
                         "consent": {"type": "boolean", "default": False,
                                     "description": "True if the customer agreed to messages about this booking. Without it no reminder is sent."}},
                        ["service_id", "starts_at"]),
    "BookingMove": obj({"starts_at": TIME}, ["starts_at"]),
    "BookingOutcome": obj({"outcome": enum("attended", "missed")}, ["outcome"]),
    "Slot": obj({"starts_at": TIME, "remaining": {"type": "integer", "minimum": 1}}, ["starts_at", "remaining"]),
    "WithheldMessage": obj({"id": UUID, "contact_id": nullable(UUID), "purpose": S,
                            "status": enum("withheld", "failed"), "reason": S, "due_at": TIME},
                           ["id", "purpose", "status", "reason", "due_at"]),
    "Metric": obj({"value": nullable({"type": "number"}), "numerator": INT, "denominator": INT},
                  ["value", "numerator", "denominator"],
                  "value is null when the denominator is zero; the dashboard then shows \"no data\"."),
    "Metrics": obj({
        "from": TIME, "to": TIME,
        "first_reply_seconds_median": nullable({"type": "number"}),
        "pack_metrics": {"type": "object", "additionalProperties": True,
                         "description": "Metrics the tenant's pack supplies. For the booking pack: inquiry_to_booking_rate and no_show_rate, each with value, numerator and denominator, and appointments_without_outcome."},
        "handover_rate": ref("Metric"), "unanswered_handovers": INT,
        "containment_rate": ref("Metric"),
        "model_cost_per_session_minor": nullable({"type": "number"}),
        "channel_fees_per_session_minor": nullable({"type": "number"})},
        ["from", "to", "handover_rate", "containment_rate", "pack_metrics"]),
    "DeletionRequest": obj({"confirm": {"type": "boolean", "const": True}}, ["confirm"]),
    "Accepted": obj({"status": enum("accepted")}, ["status"]),
    "Health": obj({"status": enum("ok", "unavailable")}, ["status"]),
    "WebhookEvent": {"type": "object", "additionalProperties": True,
                     "description": "The channel's own payload. Its shape is defined by the channel, not here; contract tests use dated, synthetic fixtures."},
}

def page(n):
    return obj({"items": arr(ref(n)), "next_cursor": nullable(S)}, ["items", "next_cursor"])

def js(schema):
    return {"application/json": {"schema": schema}}

def problem(desc):
    return {"description": desc, "content": {"application/problem+json": {"schema": ref("Problem")}}}

RESP = {
    "BadRequest": problem("The request is malformed."),
    "Unauthenticated": problem("Not signed in, or the session has ended."),
    "Forbidden": problem("The role does not allow this, or the forgery-protection token is missing or wrong."),
    "NotFound": problem("No such resource in this tenant."),
    "Conflict": problem("The request conflicts with the current state. The code says how."),
    "Invalid": problem("A value is outside its allowed range. Each field is named."),
    "TooManyRequests": problem("Too many requests."),
}
def rref(n):
    return {"$ref": f"#/components/responses/{n}"}
ERR = {400: rref("BadRequest"), 401: rref("Unauthenticated"), 403: rref("Forbidden"), 404: rref("NotFound"),
       409: rref("Conflict"), 422: rref("Invalid"), 429: rref("TooManyRequests")}

paths = {}
op_ids = set()

def op(method, path, op_id, tag, summary, role, body=None, ok=None, ok_code=200, errors=(), params=(), desc=None,
       ok_desc="Success.", idem=False, extra=None):
    assert op_id not in op_ids, op_id
    op_ids.add(op_id)
    o = {"operationId": op_id, "tags": [tag], "summary": summary, "x-role": role}
    if tag == "Bookings":
        o["x-pack"] = "booking"
    if desc:
        o["description"] = desc
    ps = []
    for seg in path.split("/"):
        if seg.startswith("{"):
            ps.append({"name": seg[1:-1], "in": "path", "required": True, "schema": UUID})
    ps += list(params)
    if idem:
        ps.append({"$ref": "#/components/parameters/IdempotencyKey"})
    if ps:
        o["parameters"] = ps
    if body is not None:
        o["requestBody"] = {"required": True, "content": js(body)}
    resp = {}
    if ok is None:
        resp[str(ok_code)] = {"description": ok_desc}
    else:
        resp[str(ok_code)] = {"description": ok_desc, "content": js(ok)}
    codes = set(errors)
    if role == "public":
        o["security"] = []
        codes |= {400, 429}
    else:
        codes |= {400, 401, 403}
        if method != "get":
            o["security"] = [{"sessionCookie": [], "csrfToken": []}]
    if "{" in path:
        codes.add(404)
    if body is not None:
        codes.add(422)
    for c in sorted(codes):
        resp[str(c)] = ERR[c]
    if extra:
        resp.update(extra)
    o["responses"] = resp
    paths.setdefault(path, {})[method] = o

def q(name, schema, desc=None, required=False):
    p = {"name": name, "in": "query", "required": required, "schema": schema}
    if desc:
        p["description"] = desc
    return p

CUR = [q("cursor", S, "The next_cursor of the previous page."), q("limit", {"type": "integer", "minimum": 1, "maximum": 100, "default": 50})]
A = "/api/v1"

# Operational
op("get", "/healthz", "getHealth", "Operations", "Process is running", "public", ok=ref("Health"))
op("get", "/readyz", "getReadiness", "Operations", "Process can reach the database", "public", ok=ref("Health"),
   extra={"503": {"description": "Not ready.", "content": js(ref("Health"))}})

# Channel webhook
op("get", "/webhooks/whatsapp", "verifyWebhook", "Channel webhook", "Answer the channel's subscription check", "public",
   params=[q("hub.mode", S, required=True), q("hub.verify_token", S, required=True), q("hub.challenge", S, required=True)],
   desc="The channel calls this once when the webhook is registered. The token is compared with a configured secret.",
   ok_desc="The challenge, echoed as plain text.",
   extra={"200": {"description": "The challenge, echoed as plain text.", "content": {"text/plain": {"schema": S}}},
          "403": problem("The verify token is wrong.")})
op("post", "/webhooks/whatsapp", "receiveWebhook", "Channel webhook", "Receive messages and status events", "public",
   body=ref("WebhookEvent"),
   params=[{"name": "X-Hub-Signature-256", "in": "header", "required": True, "schema": S,
            "description": "HMAC-SHA256 of the raw request body, as the channel sends it."}],
   desc="Verified, stored and queued in one transaction, then acknowledged. Nothing else happens in the request. "
        "A duplicate event is acknowledged and ignored. An event for an unknown number is acknowledged and stored as metadata only.",
   ok_desc="Stored, or a duplicate.",
   extra={"401": problem("The signature is missing or wrong. Nothing is stored."),
          "413": problem("The body is larger than the limit."),
          "429": problem("Only for requests with a bad signature, per source."),
          "503": problem("The database is unavailable. The channel redelivers later.")})
for _c in ("422", "400"):
    del paths["/webhooks/whatsapp"]["post"]["responses"][_c]

# Authentication
T = "Authentication"
op("post", A + "/auth/sign-in", "signIn", T, "Sign in", "public", body=ref("SignIn"), ok=ref("Session"),
   desc="Sets the session cookie. The response is the same for a wrong password and an unknown address.",
   extra={"401": problem("The email or password is wrong, or the account is locked."),})
op("post", A + "/auth/sign-out", "signOut", T, "Sign out", "agent", ok_code=204, ok_desc="Signed out.")
op("get", A + "/session", "getSession", T, "The current user, tenant and forgery-protection token", "agent", ok=ref("Session"))
op("post", A + "/auth/password", "changePassword", T, "Change your own password", "agent", body=ref("PasswordChange"),
   ok_code=204, ok_desc="Changed. Every other session of this user has ended.")
op("post", A + "/auth/password-reset/request", "requestPasswordReset", T, "Ask for a reset link", "public",
   body=ref("EmailOnly"), ok=ref("Accepted"), ok_code=202,
   ok_desc="Always this response, whether or not the address has an account.")
op("post", A + "/auth/password-reset/confirm", "confirmPasswordReset", T, "Set a new password with a reset link", "public",
   body=ref("TokenPassword"), ok_code=204, ok_desc="Password set. Every session of this user has ended.",
   extra={"410": problem("The link is used, expired or unknown.")})
op("post", A + "/auth/invitations/accept", "acceptInvitation", T, "Set a password with an invitation link", "public",
   body=ref("TokenPassword"), ok_code=204, ok_desc="The account is active. Sign in next.",
   extra={"410": problem("The link is used, expired or unknown.")})

# Tenant
T = "Tenant"
op("get", A + "/tenant", "getTenant", T, "The tenant, its settings and whether it is answering", "agent", ok=ref("Tenant"))
op("patch", A + "/tenant/settings", "updateSettings", T, "Change settings", "owner", body=ref("Settings"),
   ok=ref("SettingsResult"), desc="Any subset of settings. A value outside its range saves nothing. Warnings, such as a default language whose templates are not approved, do not stop the save.")
op("get", A + "/tenant/channel", "getChannel", T, "Channel connection status", "agent", ok=ref("ChannelStatus"))
op("put", A + "/tenant/channel", "setChannelCredentials", T, "Enter channel credentials", "owner", body=ref("ChannelCredentials"),
   ok=ref("ChannelStatus"), errors=[409],
   desc="The credentials are checked with the channel before they are stored. They are stored encrypted and never returned.")
op("post", A + "/tenant/channel/check", "checkChannel", T, "Check the stored credentials now", "owner", ok=ref("ChannelStatus"), errors=[409])
op("get", A + "/tenant/templates", "listTemplates", T, "Approval status of each template and language", "agent", ok=arr(ref("Template")))

# Users
T = "Users"
op("get", A + "/users", "listUsers", T, "List users", "owner", ok=arr(ref("User")))
op("post", A + "/users", "inviteUser", T, "Invite a person by email", "owner", body=ref("UserInvite"), ok=ref("User"), ok_code=201,
   errors=[409], ok_desc="Invited. A link is emailed.")
op("patch", A + "/users/{userId}", "changeUserRole", T, "Change a user's role", "owner", body=ref("UserRole"), ok=ref("User"), errors=[409])
op("delete", A + "/users/{userId}", "removeUser", T, "Remove a user", "owner", ok_code=204, errors=[409],
   ok_desc="Removed. Their sessions have ended.")

# Business data
T = "Business data"
op("get", A + "/services", "listServices", T, "List services", "agent", ok=arr(ref("Service")))
op("post", A + "/services", "createService", T, "Add a service", "owner", body=ref("ServiceInput"), ok=ref("Service"), ok_code=201)
op("patch", A + "/services/{serviceId}", "updateService", T, "Change a service", "owner", body=ref("ServiceInput"), ok=ref("Service"))
op("delete", A + "/services/{serviceId}", "deleteService", T, "Remove a service", "owner", ok_code=204,
   ok_desc="Deleted, or deactivated if it has bookings.")
op("get", A + "/opening-hours", "getOpeningHours", T, "Opening hours", "agent", ok=ref("OpeningHours"))
op("put", A + "/opening-hours", "setOpeningHours", T, "Replace opening hours", "owner", body=ref("OpeningHours"),
   ok=ref("OpeningHoursResult"), desc="Saved even if future bookings now fall outside the hours. A warning says so; the bookings are kept, and the booking pack lists them through listBookings with outside_opening_hours.")
op("get", A + "/policies", "listPolicies", T, "List policies", "agent", ok=arr(ref("Policy")))
op("post", A + "/policies", "createPolicy", T, "Add a policy", "owner", body=ref("PolicyInput"), ok=ref("Policy"), ok_code=201)
op("patch", A + "/policies/{policyId}", "updatePolicy", T, "Change a policy", "owner", body=ref("PolicyInput"), ok=ref("Policy"))
op("delete", A + "/policies/{policyId}", "deletePolicy", T, "Remove a policy", "owner", ok_code=204)

# Conversations and handovers
T = "Conversations"
op("get", A + "/conversations", "listConversations", T, "List conversations", "agent", ok=page("Conversation"),
   params=[q("filter", enum("all", "handed-over", "unanswered"))] + CUR)
op("get", A + "/conversations/{conversationId}", "getConversation", T, "One conversation", "agent", ok=ref("Conversation"))
op("get", A + "/conversations/{conversationId}/messages", "listMessages", T, "Message history, newest first", "agent",
   ok=page("Message"), params=CUR)
op("post", A + "/conversations/{conversationId}/takeover", "takeOver", T, "Take the conversation over", "agent",
   ok=ref("Handover"), errors=[409],
   desc="Hands the current session over with reason `staff`, or takes hold of an open handover nobody holds. An assistant reply not yet sent is discarded.")
op("post", A + "/conversations/{conversationId}/messages", "sendStaffMessage", T, "Send a staff message", "agent",
   body=ref("StaffMessageInput"), ok=ref("Message"), ok_code=202, errors=[409], idem=True,
   ok_desc="Queued for sending. Its status changes as the channel reports.",
   desc="Only the user holding the handover may send. Free-form text is allowed only while the reply window is open.")
T = "Handovers"
op("get", A + "/handovers", "listHandovers", T, "The waiting list, urgent handovers first", "agent", ok=page("Handover"),
   params=[q("state", enum("open", "unanswered", "closed"))] + CUR)
op("post", A + "/handovers/{handoverId}/release", "releaseHandover", T, "Give up the hold without ending the handover", "agent",
   ok=ref("Handover"), errors=[409])
op("post", A + "/handovers/{handoverId}/hand-back", "handBack", T, "Hand the conversation back to the assistant", "agent",
   ok=ref("Handover"), errors=[409])
op("post", A + "/handovers/{handoverId}/close", "closeHandover", T, "Close an unanswered handover with a reason", "agent",
   body=ref("HandoverClose"), ok=ref("Handover"), errors=[409])
op("post", A + "/handovers/{handoverId}/follow-up", "sendFollowUp", T, "Send the follow-up template", "agent",
   ok=ref("Handover"), ok_code=202, errors=[409], idem=True,
   ok_desc="Queued, held to the end of quiet hours, or withheld; see followup_status.",
   desc="Available only while the reply window is closed and no follow-up has been sent for this handover.")

# Bookings
T = "Bookings"
op("get", A + "/bookings", "listBookings", T, "List bookings by start time", "agent", ok=page("Booking"),
   params=[q("from", TIME), q("to", TIME), q("state", enum("booked", "confirmed", "cancelled", "attended", "missed")),
           q("outside_opening_hours", BOOL, "Only future bookings that fall outside the current opening hours (US-D2).")] + CUR)
op("get", A + "/booking-service-settings/{serviceId}", "getBookingServiceSettings", T, "A service's duration and capacity", "agent",
   ok=ref("BookingServiceSettings"))
op("put", A + "/booking-service-settings/{serviceId}", "setBookingServiceSettings", T, "Set a service's duration and capacity", "owner",
   body=ref("BookingServiceSettings"), ok=ref("BookingServiceSettings"))
op("get", A + "/slots", "listSlots", T, "Free slots for a service", "agent", ok=arr(ref("Slot")),
   params=[q("service_id", UUID, required=True), q("from", TIME, required=True), q("to", TIME, required=True)])
op("post", A + "/bookings", "createBooking", T, "Add a booking by hand", "agent", body=ref("BookingInput"), ok=ref("Booking"),
   ok_code=201, errors=[409], idem=True, desc="Refused with `no-capacity` if the slot is full.")
op("post", A + "/bookings/{bookingId}/move", "moveBooking", T, "Move a booking", "agent", body=ref("BookingMove"), ok=ref("Booking"),
   errors=[409], idem=True, desc="No cut-off applies to staff. Creates a booking-change notice to the customer.")
op("post", A + "/bookings/{bookingId}/cancel", "cancelBooking", T, "Cancel a booking", "agent", ok=ref("Booking"), errors=[409],
   idem=True, desc="Creates a booking-change notice to the customer.")
op("put", A + "/bookings/{bookingId}/outcome", "recordOutcome", T, "Record attended or missed", "agent", body=ref("BookingOutcome"),
   ok=ref("Booking"), errors=[409], desc="Refused with `not-started` before the start time.")
op("get", A + "/blocked-periods", "listBlockedPeriods", T, "List blocked periods", "agent", ok=arr(ref("BlockedPeriod")),
   params=[q("from", TIME), q("to", TIME)])
op("post", A + "/blocked-periods", "createBlockedPeriod", T, "Block a period", "agent", body=ref("BlockedPeriodInput"),
   ok=ref("BlockedPeriod"), ok_code=201, errors=[409],
   desc="If the period contains bookings and keep_bookings is not true, the request is refused with `contains-bookings` and nothing is saved.")
op("delete", A + "/blocked-periods/{blockedPeriodId}", "deleteBlockedPeriod", T, "Remove a blocked period", "agent", ok_code=204)
op("get", A + "/withheld-messages", "listWithheldMessages", T, "Messages that were withheld or failed", "agent",
   ok=page("WithheldMessage"), params=CUR)

# Metrics
op("get", A + "/metrics", "getMetrics", "Metrics", "Results for a period", "owner", ok=ref("Metrics"),
   params=[q("from", TIME, required=True), q("to", TIME, required=True)])

# Contact data
T = "Contact data"
op("post", A + "/contacts/search", "findContact", T, "Find a contact by phone number", "owner", body=ref("ContactSearch"),
   ok=ref("Contact"), desc="A POST so that the number is never in a URL or an access log.",
   extra={"404": problem("No data is held for that number.")})
op("get", A + "/contacts/{contactId}/export", "exportContact", T, "Export everything held about a contact", "owner",
   errors=[429], ok_desc="A JSON file, sent as a download.",
   extra={"200": {"description": "A JSON file, sent as a download.",
                  "headers": {"Content-Disposition": {"schema": S}},
                  "content": {"application/json": {"schema": {"type": "object", "additionalProperties": True}}}}})
op("post", A + "/contacts/{contactId}/deletion", "deleteContact", T, "Delete a contact's data", "owner",
   body=ref("DeletionRequest"), ok=ref("Accepted"), ok_code=202, ok_desc="Accepted. Deletion completes within 24 hours.")

doc = {
    "openapi": "3.1.1",
    "info": {
        "title": "Polyglot Sales Agent API",
        "version": "0.1.0",
        "summary": "Channel webhook and dashboard API. Design-time contract.",
        "description": "Written by hand in the design phase. From milestone M2 this file is generated from the route schemas. "
                       "Conventions, error codes and the role of each route are explained in docs/design/api.md.",
        "license": {"name": "MIT", "identifier": "MIT"},
    },
    "servers": [{"url": "http://localhost:3000", "description": "Local development"}],
    "tags": [{"name": n, "description": d} for n, d in [
        ("Operations", "Liveness and readiness checks for the process."),
        ("Channel webhook", "The endpoints the messaging channel calls: the subscription check, and incoming messages and status events."),
        ("Authentication", "Signing in and out, the current session, and setting or resetting a password."),
        ("Tenant", "The business's own record: its settings, channel connection and message templates."),
        ("Users", "The people who can sign in to a tenant's dashboard, and their roles."),
        ("Business data", "The services, opening hours and policies the assistant answers from."),
        ("Conversations", "Customer conversations: reading them, sending a staff message and taking one over."),
        ("Handovers", "Conversations waiting for a person, and what staff can do with them."),
        ("Bookings", "Appointments, free slots, blocked periods, and booking messages that were withheld or failed."),
        ("Metrics", "Results for a period."),
        ("Contact data", "Finding a contact, and exporting or deleting the data held about them."),
    ]],
    "security": [{"sessionCookie": []}],
    "paths": paths,
    "components": {
        "securitySchemes": {
            "sessionCookie": {"type": "apiKey", "in": "cookie", "name": "__Host-session",
                              "description": "Set at sign-in. Not readable by scripts, HTTPS only, same-site."},
            "csrfToken": {"type": "apiKey", "in": "header", "name": "X-CSRF-Token",
                          "description": "The csrf_token of the current session. Required on every request that is not a GET."},
        },
        "parameters": {
            "IdempotencyKey": {"name": "Idempotency-Key", "in": "header", "required": True,
                               "schema": {"type": "string", "minLength": 16, "maxLength": 64},
                               "description": "A value the client makes up once per intended action. A repeat with the same key returns the first result."},
        },
        "responses": RESP,
        "schemas": schemas,
    },
}

class D(yaml.SafeDumper):
    def ignore_aliases(self, data):
        return True

with open(OUT, "w") as f:
    f.write("# Design-time contract for issue #41. See docs/design/api.md.\n")
    yaml.dump(doc, f, Dumper=D, sort_keys=False, width=120, allow_unicode=True)

n_ops = sum(len(v) for v in paths.values())
roles = {}
for v in paths.values():
    for o in v.values():
        roles[o["x-role"]] = roles.get(o["x-role"], 0) + 1
print(len(paths), "paths", n_ops, "operations", roles, len(schemas), "schemas")
