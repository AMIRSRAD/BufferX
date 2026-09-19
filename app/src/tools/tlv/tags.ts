/**
 * TLV tag naming.
 *
 * Three sources, consulted in this order and surfaced verbatim in the tool's
 * help disclosure (UX_SPEC 3.5, "the dictionary source noted in the tool's help
 * disclosure"):
 *
 *  1. The engine's own path table, returned on every `tlv.parse` as
 *     `flat[].description`. It is authoritative because it is the table the
 *     packagers were written against.
 *  2. `PATH_DESCRIPTIONS` below, which mirrors that same table for the nodes the
 *     engine's flattener never emits — it flattens leaves only, so a constructed
 *     node such as `71/64` has a name in the core table that never reaches the
 *     wire. Keeping the mirror here is what lets the tree label its branches.
 *  3. `EMV_TAGS`, keyed by tag rather than by path, for the EMVCo-defined data
 *     elements that appear inside any ICC-bearing field.
 *
 * A tag matched by none of the three renders as `unknown tag` — never as a
 * guess, and never as blank space.
 */

/** Rendered in the help disclosure. Keep in step with the tables below. */
export const DICTIONARY_SOURCES: readonly string[] = [
  'Engine path table — core/src/Tlv.cpp, returned as flat[].description on every parse.',
  'EMVCo Book 3 Annex A — application and ICC data elements, keyed by tag.',
]

/** Shown where no dictionary matches. */
export const UNKNOWN_TAG_LABEL = 'unknown tag'

/**
 * Mirror of `kTagDescriptions` in core/src/Tlv.cpp. Paths join tag *bytes* with
 * `/`, exactly as `tlvtool::flatten` builds them, so a two-byte tag `9F02`
 * contributes the segment `9F/02`.
 */
export const PATH_DESCRIPTIONS: Readonly<Record<string, string>> = {
  '71/62/81': 'Terminal batch number',
  '71/61/8C': 'Reason code',
  '71/6F/89': 'Display language code',
  '71/65/83': 'Card CVV2',
  '71/6B/81': 'Terminal firmware version (A.B.C.D)',
  '71/68/86': 'Switch trace code',
  '71/6F/87': 'Destination card PAN',
  '71/64': 'Billing information',
  '71/64/88': 'Billing entry index',
  '71/64/82': 'Billing entry date',
  '71/64/85': 'Billing amount #1',
  '71/64/86': 'Billing amount #2',
  '71/64/89': 'Billing amount #3',
  '71/64/87': 'Charge-back flag',
  '71/68/99': 'ACK confirmation method',
  '71/63/81': 'New PIN block',
  '71/6F/84': 'Card status',
  '71/65/82': 'Customer profile',
}

/** EMVCo data elements, keyed by the compact uppercase tag. */
export const EMV_TAGS: Readonly<Record<string, string>> = {
  '42': 'Issuer Identification Number (IIN)',
  '4F': 'Application Identifier (AID), card',
  '50': 'Application Label',
  '57': 'Track 2 Equivalent Data',
  '5A': 'Application PAN',
  '61': 'Application Template',
  '6F': 'File Control Information (FCI) Template',
  '70': 'READ RECORD Response Message Template',
  '71': 'Issuer Script Template 1',
  '72': 'Issuer Script Template 2',
  '73': 'Directory Discretionary Template',
  '77': 'Response Message Template Format 2',
  '80': 'Response Message Template Format 1',
  '81': 'Amount, Authorised (Binary)',
  '82': 'Application Interchange Profile (AIP)',
  '83': 'Command Template',
  '84': 'Dedicated File (DF) Name',
  '86': 'Issuer Script Command',
  '87': 'Application Priority Indicator',
  '88': 'Short File Identifier (SFI)',
  '89': 'Authorisation Code',
  '8A': 'Authorisation Response Code (ARC)',
  '8C': 'Card Risk Management Data Object List 1 (CDOL1)',
  '8D': 'Card Risk Management Data Object List 2 (CDOL2)',
  '8E': 'Cardholder Verification Method (CVM) List',
  '8F': 'Certification Authority Public Key Index',
  '90': 'Issuer Public Key Certificate',
  '91': 'Issuer Authentication Data',
  '92': 'Issuer Public Key Remainder',
  '93': 'Signed Static Application Data',
  '94': 'Application File Locator (AFL)',
  '95': 'Terminal Verification Results (TVR)',
  '97': 'Transaction Certificate Data Object List (TDOL)',
  '98': 'Transaction Certificate (TC) Hash Value',
  '99': 'Transaction PIN Data',
  '9A': 'Transaction Date',
  '9B': 'Transaction Status Information (TSI)',
  '9C': 'Transaction Type',
  '9D': 'Directory Definition File (DDF) Name',
  A5: 'File Control Information (FCI) Proprietary Template',
  BF0C: 'File Control Information (FCI) Issuer Discretionary Data',
  '5F20': 'Cardholder Name',
  '5F24': 'Application Expiration Date',
  '5F25': 'Application Effective Date',
  '5F28': 'Issuer Country Code',
  '5F2A': 'Transaction Currency Code',
  '5F2D': 'Language Preference',
  '5F30': 'Service Code',
  '5F34': 'Application PAN Sequence Number',
  '5F36': 'Transaction Currency Exponent',
  '5F50': 'Issuer URL',
  '5F53': 'International Bank Account Number (IBAN)',
  '5F54': 'Bank Identifier Code (BIC)',
  '5F55': 'Issuer Country Code (alpha2)',
  '5F56': 'Issuer Country Code (alpha3)',
  '5F57': 'Account Type',
  '9F01': 'Acquirer Identifier',
  '9F02': 'Amount, Authorised (Numeric)',
  '9F03': 'Amount, Other (Numeric)',
  '9F04': 'Amount, Other (Binary)',
  '9F05': 'Application Discretionary Data',
  '9F06': 'Application Identifier (AID), terminal',
  '9F07': 'Application Usage Control',
  '9F08': 'Application Version Number, card',
  '9F09': 'Application Version Number, terminal',
  '9F0B': 'Cardholder Name Extended',
  '9F0D': 'Issuer Action Code — Default',
  '9F0E': 'Issuer Action Code — Denial',
  '9F0F': 'Issuer Action Code — Online',
  '9F10': 'Issuer Application Data',
  '9F11': 'Issuer Code Table Index',
  '9F12': 'Application Preferred Name',
  '9F13': 'Last Online ATC Register',
  '9F14': 'Lower Consecutive Offline Limit',
  '9F15': 'Merchant Category Code',
  '9F16': 'Merchant Identifier',
  '9F17': 'PIN Try Counter',
  '9F18': 'Issuer Script Identifier',
  '9F1A': 'Terminal Country Code',
  '9F1B': 'Terminal Floor Limit',
  '9F1C': 'Terminal Identification',
  '9F1D': 'Terminal Risk Management Data',
  '9F1E': 'Interface Device (IFD) Serial Number',
  '9F1F': 'Track 1 Discretionary Data',
  '9F20': 'Track 2 Discretionary Data',
  '9F21': 'Transaction Time',
  '9F22': 'Certification Authority Public Key Index, terminal',
  '9F23': 'Upper Consecutive Offline Limit',
  '9F26': 'Application Cryptogram',
  '9F27': 'Cryptogram Information Data (CID)',
  '9F2D': 'ICC PIN Encipherment Public Key Certificate',
  '9F2E': 'ICC PIN Encipherment Public Key Exponent',
  '9F2F': 'ICC PIN Encipherment Public Key Remainder',
  '9F32': 'Issuer Public Key Exponent',
  '9F33': 'Terminal Capabilities',
  '9F34': 'Cardholder Verification Method (CVM) Results',
  '9F35': 'Terminal Type',
  '9F36': 'Application Transaction Counter (ATC)',
  '9F37': 'Unpredictable Number',
  '9F38': 'Processing Options Data Object List (PDOL)',
  '9F39': 'Point-of-Service (POS) Entry Mode',
  '9F3A': 'Amount, Reference Currency',
  '9F3B': 'Application Reference Currency',
  '9F3C': 'Transaction Reference Currency Code',
  '9F3D': 'Transaction Reference Currency Exponent',
  '9F40': 'Additional Terminal Capabilities',
  '9F41': 'Transaction Sequence Counter',
  '9F42': 'Application Currency Code',
  '9F43': 'Application Reference Currency Exponent',
  '9F44': 'Application Currency Exponent',
  '9F45': 'Data Authentication Code',
  '9F46': 'ICC Public Key Certificate',
  '9F47': 'ICC Public Key Exponent',
  '9F48': 'ICC Public Key Remainder',
  '9F49': 'Dynamic Data Authentication Data Object List (DDOL)',
  '9F4A': 'Static Data Authentication Tag List',
  '9F4B': 'Signed Dynamic Application Data',
  '9F4C': 'ICC Dynamic Number',
  '9F4D': 'Log Entry',
  '9F4E': 'Merchant Name and Location',
  '9F4F': 'Log Format',
  '9F51': 'Application Currency Code (proprietary)',
  '9F53': 'Consecutive Transaction Limit (International)',
  '9F5B': 'Issuer Script Results',
  '9F66': 'Terminal Transaction Qualifiers (TTQ)',
  '9F6E': 'Form Factor Indicator',
  '9F7C': 'Customer Exclusive Data',
}

/** Name for a full path such as `71/64/88`, or `undefined` when unknown. */
export function describePath(path: string): string | undefined {
  return PATH_DESCRIPTIONS[path]
}

/** Name for a compact tag such as `9F02`, or `undefined` when unknown. */
export function describeTag(tagHex: string): string | undefined {
  return EMV_TAGS[tagHex.toUpperCase()]
}
