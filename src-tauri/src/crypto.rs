// crypto.rs
// שכבת ההצפנה המלאה של האפליקציה
// argon2  → גזירת מפתח מסיסמה
// aes-gcm → הצפנה/פענוח של נתונים
use zeroize::Zeroize;
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use aes_gcm::aead::rand_core::RngCore;
use argon2::{Argon2, PasswordHasher, password_hash::SaltString};
use thiserror::Error;

// ── שגיאות ─────────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("שגיאת הצפנה")]
    EncryptionFailed,
    #[error("שגיאת פענוח — סיסמה שגויה או נתונים פגומים")]
    DecryptionFailed,
    #[error("שגיאת גזירת מפתח")]
    KeyDerivationFailed,
    #[error("נתונים לא תקינים: {0}")]
    InvalidData(String),
}

impl serde::Serialize for CryptoError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::Serializer {
        serializer.serialize_str(&self.to_string())
    }
}

// ── קבועים ─────────────────────────────────────────────────

const NONCE_LEN:   usize = 12; // AES-GCM nonce: 96 bit
const SALT_LEN:    usize = 32; // salt ל-argon2
const KEY_LEN:     usize = 32; // AES-256

// ── טיפוסים ────────────────────────────────────────────────

/// המפתח הנגזר שנשמר בזיכרון בזמן ריצה בלבד
#[derive(Clone)]
pub struct DerivedKey(pub [u8; KEY_LEN]);

impl Drop for DerivedKey {
    fn drop(&mut self) {
        // מונע Dead Store Elimination — מוחק את המפתח מהזיכרון בבטחה
        self.0.zeroize();
    }
}

// ── salt ────────────────────────────────────────────────────

/// יוצר salt אקראי חדש (נשמר ב-DB בהגדרות הראשוניות)
pub fn generate_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// מקודד salt ל-hex לשמירה ב-DB
pub fn salt_to_hex(salt: &[u8; SALT_LEN]) -> String {
    hex::encode(salt)
}

/// מפענח salt מ-hex
pub fn salt_from_hex(s: &str) -> Result<[u8; SALT_LEN], CryptoError> {
    let bytes = hex::decode(s)
        .map_err(|_| CryptoError::InvalidData("salt hex לא תקין".into()))?;
    bytes.try_into()
        .map_err(|_| CryptoError::InvalidData("אורך salt שגוי".into()))
}

// ── גזירת מפתח ─────────────────────────────────────────────

/// גוזר מפתח AES-256 מסיסמה + salt באמצעות argon2id
pub fn derive_key(password: &str, salt: &[u8; SALT_LEN]) -> Result<DerivedKey, CryptoError> {
    let argon2 = Argon2::default(); // argon2id, תצורת ברירת מחדל

    // SaltString דורש base64 — ממירים ידנית
    let salt_b64 = base64_encode_salt(salt);
    let salt_string = SaltString::from_b64(&salt_b64)
        .map_err(|_| CryptoError::KeyDerivationFailed)?;

    let hash = argon2
        .hash_password(password.as_bytes(), &salt_string)
        .map_err(|_| CryptoError::KeyDerivationFailed)?;

    // שולפים את ה-hash עצמו (32 בתים)
    let hash_bytes = hash
        .hash
        .ok_or(CryptoError::KeyDerivationFailed)?;

    let raw = hash_bytes.as_bytes();
    if raw.len() < KEY_LEN {
        return Err(CryptoError::KeyDerivationFailed);
    }

    let mut key = [0u8; KEY_LEN];
    key.copy_from_slice(&raw[..KEY_LEN]);
    Ok(DerivedKey(key))
}

// ── הצפנה ──────────────────────────────────────────────────

/// מצפין טקסט — מחזיר hex של [nonce (12b) || ciphertext]
pub fn encrypt(plaintext: &str, key: &DerivedKey) -> Result<String, CryptoError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key.0));

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| CryptoError::EncryptionFailed)?;

    // שומרים nonce לפני ה-ciphertext
    let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(hex::encode(combined))
}

/// מפענח hex של [nonce || ciphertext] → טקסט
pub fn decrypt(hex_data: &str, key: &DerivedKey) -> Result<String, CryptoError> {
    let data = hex::decode(hex_data)
        .map_err(|_| CryptoError::InvalidData("hex לא תקין".into()))?;

    if data.len() <= NONCE_LEN {
        return Err(CryptoError::InvalidData("נתונים קצרים מדי".into()));
    }

    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let nonce  = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key.0));

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| CryptoError::DecryptionFailed)?;

    String::from_utf8(plaintext)
        .map_err(|_| CryptoError::InvalidData("תוצאת פענוח לא UTF-8".into()))
}

// ── עזר פנימי ──────────────────────────────────────────────

/// ממיר salt גולמי ל-base64 כפי שדורש SaltString
fn base64_encode_salt(salt: &[u8; SALT_LEN]) -> String {
    // base64 ללא padding, כפי ש-argon2 crate מצפה
    use std::fmt::Write;
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut i = 0;
    while i + 2 < salt.len() {
        let b0 = salt[i] as usize;
        let b1 = salt[i + 1] as usize;
        let b2 = salt[i + 2] as usize;
        let _ = write!(out, "{}{}{}{}",
            CHARS[b0 >> 2] as char,
            CHARS[((b0 & 3) << 4) | (b1 >> 4)] as char,
            CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] as char,
            CHARS[b2 & 0x3f] as char,
        );
        i += 3;
    }
    out
}

// ── unit tests ──────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let salt = generate_salt();
        let key  = derive_key("סיסמה_בדיקה_123", &salt).unwrap();
        let original = "זהו טקסט בדיקה בעברית 🔐";
        let encrypted = encrypt(original, &key).unwrap();
        let decrypted = decrypt(&encrypted, &key).unwrap();
        assert_eq!(original, decrypted);
    }

    #[test]
    fn test_wrong_key_fails() {
        let salt   = generate_salt();
        let key1   = derive_key("סיסמה_נכונה", &salt).unwrap();
        let key2   = derive_key("סיסמה_שגויה", &salt).unwrap();
        let enc    = encrypt("טקסט סודי", &key1).unwrap();
        let result = decrypt(&enc, &key2);
        assert!(result.is_err());
    }

    #[test]
    fn test_same_plaintext_different_ciphertext() {
        // nonce אקראי — אותו טקסט מייצר תוצאות שונות
        let salt = generate_salt();
        let key  = derive_key("password", &salt).unwrap();
        let enc1 = encrypt("hello", &key).unwrap();
        let enc2 = encrypt("hello", &key).unwrap();
        assert_ne!(enc1, enc2);
    }

    #[test]
    fn test_salt_hex_roundtrip() {
        let salt     = generate_salt();
        let hex      = salt_to_hex(&salt);
        let restored = salt_from_hex(&hex).unwrap();
        assert_eq!(salt, restored);
    }

    #[test]
    fn test_derive_key_deterministic() {
        // אותה סיסמה + אותו salt → אותו מפתח
        let salt = generate_salt();
        let k1   = derive_key("abc123", &salt).unwrap();
        let k2   = derive_key("abc123", &salt).unwrap();
        assert_eq!(k1.0, k2.0);
    }
}
