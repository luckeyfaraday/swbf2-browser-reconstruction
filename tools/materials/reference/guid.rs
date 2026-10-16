use std::fmt::{self, Debug, Formatter};

use bytes::BytesMut;
use serde::{Deserialize, Serialize, Serializer, Deserializer};

// UUID v3
#[derive(Default, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(C)]
pub struct Guid {
    pub data1: u32,
    pub data2: u16,
    pub data3: u16,
    pub data4: [u8; 8],
}

impl Guid {
    pub fn new(data1: u32, data2: u16, data3: u16, data4: [u8; 8]) -> Self {
        Self {
            data1,
            data2,
            data3,
            data4,
        }
    }

    pub fn from_slice(data: &[u8]) -> Self {
        Self {
            data1: u32::from_le_bytes([data[0], data[1], data[2], data[3]]),
            data2: u16::from_le_bytes([data[4], data[5]]),
            data3: u16::from_le_bytes([data[6], data[7]]),
            data4: [
                data[8], data[9], data[10], data[11], data[12], data[13], data[14], data[15],
            ],
        }
    }

    pub fn from_u128(data: u128) -> Self {
        Self {
            data1: (data >> 96) as u32,
            data2: ((data >> 80) & 0xFFFF) as u16,
            data3: ((data >> 64) & 0xFFFF) as u16,
            data4: [
                ((data >> 56) & 0xFF) as u8,
                ((data >> 48) & 0xFF) as u8,
                ((data >> 40) & 0xFF) as u8,
                ((data >> 32) & 0xFF) as u8,
                ((data >> 24) & 0xFF) as u8,
                ((data >> 16) & 0xFF) as u8,
                ((data >> 8) & 0xFF) as u8,
                (data & 0xFF) as u8,
            ],
        }
    }

    pub fn random() -> Self {
        let mut data4 = [0; 8];
        for i in 0..8 {
            data4[i] = rand::random();
        }

        Self {
            data1: rand::random(),
            data2: rand::random(),
            data3: rand::random(),
            data4,
        }
    }

    pub fn to_string(&self) -> String {
        format!(
            "{:08x}-{:04x}-{:04x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
            self.data1,
            self.data2,
            self.data3,
            self.data4[0],
            self.data4[1],
            self.data4[2],
            self.data4[3],
            self.data4[4],
            self.data4[5],
            self.data4[6],
            self.data4[7]
        )
    }

    pub fn from_str(s: &str) -> Self {
        let s = s.replace("-", "");
        let data1 = u32::from_str_radix(&s[0..8], 16).unwrap();
        let data2 = u16::from_str_radix(&s[8..12], 16).unwrap();
        let data3 = u16::from_str_radix(&s[12..16], 16).unwrap();
        let data4 = [
            u8::from_str_radix(&s[16..18], 16).unwrap(),
            u8::from_str_radix(&s[18..20], 16).unwrap(),
            u8::from_str_radix(&s[20..22], 16).unwrap(),
            u8::from_str_radix(&s[22..24], 16).unwrap(),
            u8::from_str_radix(&s[24..26], 16).unwrap(),
            u8::from_str_radix(&s[26..28], 16).unwrap(),
            u8::from_str_radix(&s[28..30], 16).unwrap(),
            u8::from_str_radix(&s[30..32], 16).unwrap(),
        ];

        Self {
            data1,
            data2,
            data3,
            data4,
        }
    }
}

impl Debug for Guid {
    fn fmt(&self, f: &mut Formatter) -> fmt::Result {
        write!(f, "{}", self.to_string())
    }
}

impl Serialize for Guid {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl<'de> Deserialize<'de> for Guid {
    fn deserialize<D>(deserializer: D) -> Result<Guid, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        Ok(Guid::from_str(&s))
    }
}

pub trait BytesGuidExt {
    fn get_guid(&mut self) -> Guid;
}

impl BytesGuidExt for BytesMut {
    fn get_guid(&mut self) -> Guid {
        Guid::from_slice(&self.split_to(16))
    }
}
