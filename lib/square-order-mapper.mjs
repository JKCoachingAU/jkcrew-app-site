export function normalizeSquareOrder(payload) {
  const order = payload?.order || payload;
  const lineItems = order?.line_items || [];
  const fulfillment = order?.fulfillments?.[0] || {};
  const recipient = fulfillment?.shipment_details?.recipient || fulfillment?.pickup_details?.recipient || {};
  const metadata = order?.metadata || {};

  return {
    id: order?.id || payload?.data?.id || "",
    lineItems: lineItems.map(item => ({
      name: item.name || "",
      variationName: item.variation_name || "",
      catalogObjectId: item.catalog_object_id || "",
      quantity: Number(item.quantity || 1)
    })),
    riderName: metadata.rider_name || metadata.rider || metadata.student_name || "",
    parentName: metadata.parent_name || recipient.display_name || "",
    parentPhone: metadata.parent_phone || metadata.mobile || recipient.phone_number || "",
    parentEmail: metadata.parent_email || recipient.email_address || ""
  };
}

export function findClassForLineItem(lineItem, classes) {
  const keys = [
    lineItem.name,
    lineItem.variationName,
    lineItem.catalogObjectId
  ].filter(Boolean).map(value => String(value).trim().toLowerCase());

  return classes.find(lessonClass => keys.includes(String(lessonClass.squareKey || "").trim().toLowerCase()));
}

export function buildSignupSms({ riderName, signupUrl }) {
  return `Thanks for signing ${riderName || "your rider"} up for JKCoaching. Join JKCommunity for lesson info, bookings, rider progress and updates: ${signupUrl}`;
}
