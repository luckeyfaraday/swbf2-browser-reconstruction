use glacier_resource_proc::{RvmTypeEnum, RvmTypeInfo};
use glacier_util::guid::Guid;
use serde::{Deserialize, Serialize};
use serde_with::{serde_as, Bytes};
use strum_macros::IntoStaticStr;

macro_rules! rvm_boxed {
    ($name:ident) => {
        paste::paste! {
            #[derive(Debug, Clone, Serialize, Deserialize)]
            pub struct [<$name Boxed>](pub Box<$name>);

            impl [<$name Boxed>] {
                pub fn data_size() -> usize {
                    $name::data_size()
                }

                pub fn hash() -> u32 {
                    $name::hash()
                }

                pub fn self_hash(&self) -> u32 {
                    Self::hash()
                }

                pub fn from_slice(data: &[u8]) -> Self {
                    Self(Box::new(unsafe {
                        std::ptr::read(data.as_ptr() as *const $name)
                    }))
                }

                pub fn to_slice(&self) -> &[u8] {
                    unsafe {
                        std::slice::from_raw_parts(
                            self as *const Self as *const u8,
                            Self::data_size(),
                        )
                    }
                }
            }
        }
    };
}

#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x04E8CA7D)]
pub struct RvmSerializedDb_ns_Dx11SerializedBlendState {
    #[serde_as(as = "Bytes")]
    pub data: [u8; 0x80],
}

rvm_boxed!(RvmSerializedDb_ns_Dx11SerializedBlendState);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x0B87FA95)]
pub struct RvmSerializedDb_ns_Vec {
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub w: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x1CEE5632)]
pub struct RvmLegacyLightMapInstance {
    pub data: [u8; 0x20],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x23166F15)]
pub struct RvmSerializedDb_ns_Dx11VsShader {
    pub data: [u8; 0x20],
    pub dx11_byte_code_element: u64,
    pub unk2: u64,
    pub dx11_input_element: u64,
    pub unk3: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x2EFE3369)]
pub struct RvmSerializedDb_ns_SerializedParamDbKey {
    pub hash: u64,
    pub type_hash: u32,
    pub element_count: u16,
    pub legacy_high: u16,
}

#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x7416FA4F)]
pub struct RvmSerializedDb_ns_ProjectionState {
    pub matrix: [f32; 16],
    #[serde_as(as = "Bytes")]
    pub rest: [u8; 0x50],
}

rvm_boxed!(RvmSerializedDb_ns_ProjectionState);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xAB6472B8)]
pub struct RvmSerializedDb_ns_StencilState {
    pub data: [u8; 0x10],
}

#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xC60DCB0D)]
pub struct RvmSerializedDb_ns_Dx11Sampler {
    #[serde_as(as = "Bytes")]
    pub data: [u8; 0x40],
}

rvm_boxed!(RvmSerializedDb_ns_Dx11Sampler);

#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xDA99C37E)]
pub struct RvmLegacyLightProbes {
    #[serde_as(as = "Bytes")]
    pub data: [u8; 0x90],
}

rvm_boxed!(RvmLegacyLightProbes);

#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xF0F92EDF)]
pub struct RvmSerializedDb_ns_ViewState {
    #[serde_as(as = "Bytes")]
    pub data: [u8; 0x140],
}

rvm_boxed!(RvmSerializedDb_ns_ViewState);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x01EC4994)]
pub struct RvmSerializedDb_ns_DefaultValueRef {
    pub hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x0247D1B0)]
pub struct RvmSerializedDb_ns_InstructionBatchRef {
    pub hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x057BA51E)]
pub struct RvmSerializedDb_ns_Dx11ApplyParametersBlock {
    pub unk1: u64,
    pub rvm_slot_handle: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x0746CEFA)]
pub struct RvmSerializedDb_ns_RvmPermutation {
    pub guid: Guid,
    pub index1: u16,
    pub index2: u16,
    pub unk1: u8,
    pub unk2: u8,
    pub unk3: u16,
    pub rvm_function_instance_ref: u64,
    pub rvm_context_sort_key_info: u64,
    pub hash3: u64,
    pub rvm_dispatch: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x0CC971F4)]
pub struct RvmSerializedDb_ns_Int64(i64);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x0D9B2921)]
pub struct RvmSerializedDb_ns_InstructionBatch {
    pub runtime_instantiated_type: u64,
    /// This can be a ref to any "InstructionData" or "InstructionBatch" type
    pub instruction_ref: u64,
    pub unk2: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x140AFC4E)]
pub struct RvmSerializedDb_ns_RvmFunction {
    pub unk1: u64,
    pub instruction_batch_ref: u64,
    pub unk2: u64,
    pub unk3: u64,
    pub param_db_serialized_hash_view: u64,
    pub param_db_serialized_filter_view: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x16FDAA58)]
pub struct RvmSerializedDb_ns_InstanceTableAssemblyInstructionBatchData {
    pub table_assembly_data: u64,
    pub write_op: u64,
    pub unk1: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x20149F19)]
pub struct RvmSerializedDb_ns_SurfaceShader {
    pub shared_streamable_texture_ref: u64,
    pub name_hash: u32,
    pub padding: u32,
    pub shader_streamable_external_texture_ref: u64,
    pub unk1: u32,
    pub unk2: u32,
    pub hash3: u64,
    pub hash4: u64,
    /// Found in SBD next to Guid
    pub unk3: u32,
    pub padding2: [u8; 0x0C],
    pub guid: Guid,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x26B25214)]
pub struct RvmSerializedDb_ns_Dx11LegacyVertexBufferConversionInstructionData {
    pub unk1: u64,
    pub unk2: u64,
    pub prepared_vertex_stream: u64,
    pub unk3: u64,
    pub unk4: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x2A49CA57)]
pub struct RvmSerializedDb_ns_SerializedParameterBlock {
    pub param_db_key_ref: u64,
    pub hash1: u64,
    pub unk1: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x364CB5D9)]
pub struct RvmSerializedDb_ns_RvmFunctionInputTableIndices {
    /// Points to a Uint16
    pub hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x500FE453)]
pub struct RvmSerializedDb_ns_Dx11PsShader {
    pub unk1: u64,
    pub dx11_byte_code_element: u64,
    pub unk2: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x5E9D8F4B)]
pub struct RvmSerializedDb_ns_Dx11HsShader {
    pub unk1: u64,
    pub hash: u64,
    pub unk2: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x609E0E06)]
pub struct RvmSerializedDb_ns_SerializedParameterBlockRef {
    pub hash: u64,
}

#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x687DB53F)]
pub struct RvmSerializedDb_ns_Dx11BlendStateData {
    #[serde_as(as = "Bytes")]
    pub dx11_serialized_blend_states: [u8; 4096],
}

rvm_boxed!(RvmSerializedDb_ns_Dx11BlendStateData);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x6D3403B6)]
pub struct RvmSerializedDb_ns_DirectInputInstructionData {
    pub param_db_serialized_read_view: u64,
    pub unk1: u64,
    pub unk2: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x6FBE3136)]
pub struct RvmSerializedDb_ns_Dx11TextureConversionInstructionData {
    pub rvm_slot_handle1: u64,
    pub rvm_slot_handle2: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x7091E0C7)]
pub struct RvmSerializedDb_ns_Dx11DsShader {
    pub unk1: u64,
    pub hash: u64,
    pub unk2: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x77CB507F)]
pub struct RvmSerializedDb_ns_ValueRef {
    pub hash: u64,
    pub unk1: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x7B05DCCB)]
pub struct RvmSerializedDb_ns_RvmPermutationRef {
    pub hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x7B05F918)]
pub struct RvmSerializedDb_ns_RvmPermutationSet {
    pub guid: Guid,
    pub unk1: u16,
    pub unk2: u16,
    pub unk3: u16,
    pub permutation_count: u16,
    pub unk4: u16,
    pub unk5: u16,
    pub unk6: u64,
    pub permutation_ref: u64,
    pub permutation_lookup_table: u64,
    pub param_db_hash: u64,
    pub hash4: u64,
    pub unk7: u64,
    pub unk8: u64,
    pub hash5: u64,
    pub param_db_serialized_hash_view_ref: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x8487EB54)]
pub struct RvmSerializedDb_ns_ShaderStreamableTextureRef {
    pub hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x8FD7EA81)]
pub struct RvmSerializedDb_ns_ParamDbSerializedHashView {
    pub param_db_key_ref: u64,
    pub param_db_key_ref2: u64,
    pub unk3: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x9005919C)]
pub struct RvmSerializedDb_ns_RvmDispatch {
    pub unk1: u64,
    pub instruction_batch_ref: u64,
    pub unk2: u64,
    pub unk3: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x937C3AE7)]
pub struct RvmSerializedDb_ns_RvmFunctionInstance {
    pub unk1: u64,
    pub unk2: u64,
    pub combined_serialized_parameter_block: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x950FBF90)]
pub struct RvmSerializedDb_ns_ParamDbSerializedHashViewRef {
    pub hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x9940EC93)]
pub struct RvmSerializedDb_ns_ParamDbSerializedFilterView {
    pub param_db_key_ref: u64,
    pub unk2: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x99DB2C67)]
pub struct RvmSerializedDb_ns_RuntimeInstantiatedType {
    pub rtti_type: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xB46704F1)]
pub struct RvmSerializedDb_ns_Dx11InputElement {
    /// TEXCOORD string hash
    pub semantic_name: u64,
    pub semantic_index: u32,
    pub format: u32,
    pub input_slot: u32,
    pub aligned_byte_offset: u32,
    pub input_slot_class: u32,
    pub instance_data_step_rate: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xC4450BB2)]
pub struct RvmSerializedDb_ns_CombinedSerializedParameterBlock {
    pub hash1: u64,
    pub hash2: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xC82F8081)]
pub struct RvmSerializedDb_ns_ParamDbSerializedReadView {
    pub param_db_key_ref: u64,
    pub unk2: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xCE79D69F)]
pub struct RvmSerializedDb_ns_Dx11ApplyParametersInstructionData {
    pub hash1: u64,
    pub hash2: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xD247D436)]
pub struct RvmSerializedDb_ns_RvmFunctionInstanceRef {
    pub hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xD43A4A5E)]
pub struct RvmSerializedDb_ns_ParamDbHash {
    pub hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xD5F9FA09)]
pub struct RvmSerializedDb_ns_Dx11BufferConversionInstructionData {
    pub rvm_slot_handle1: u64,
    pub rvm_slot_handle2: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xDAE7CC60)]
pub struct RvmSerializedDb_ns_Settings {
    pub unk1: u32,
    pub unk2: u32,
    pub database_name: u64,
    pub hash1: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xDD2446A9)]
pub struct RvmSerializedDb_ns_ShaderStreamableExternalTextureRef {
    pub hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xDF7CA221)]
pub struct RvmSerializedDb_ns_Dx11DispatchInstructionData {
    pub rvm_slot_handle1: u64,
    pub rvm_slot_handle2: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xDFA807CA)]
pub struct RvmSerializedDb_ns_ParamDbKeyRef {
    pub hash: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xF17B1BA6)]
pub struct RvmSerializedDb_ns_RttiType {
    pub module_name: u64,
    pub name: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xFBB62E91)]
pub struct RvmSerializedDb_ns_TableAssemblyInstructionBatchData {
    pub table_assembly_data: u64,
    pub hash1: u64,
    pub write_op_group: u64,
}

/// Probably related to the 4 shader types (vs, ps, hs, ds)
#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xFDF2A466)]
pub struct RvmSerializedDb_ns_RvmPermutationLookupTable {
    pub unk1: u16,
    pub unk2: u16,
    pub unk3: u16,
    pub unk4: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x0CC97257)]
pub struct RvmSerializedDb_ns_Int32(i32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x191C1D07)]
pub struct RvmSerializedDb_ns_ShaderDepthBiasGroup(u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x1E5FBC18)]
pub struct RvmSerializedDb_ns_ShaderStreamableExternalTexture {
    pub tex_coords_per_meter: f32,
    pub unk1: u16,
    pub texture_type: u16,
    pub name_hash: u32,
    /// Guessing this has something to do with external since the non-externals have 0xFFFF here
    pub external_hash: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x1ECE9401)]
pub struct RvmSerializedDb_ns_RenderDepthMode(u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x2DD5FBAB)]
pub struct RvmSerializedDb_ns_RvmLegacyOutdoorLightStatus(u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x3AD97822)]
pub struct RvmSerializedDb_ns_RvmLevelOfDetail(u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x518DED45)]
pub struct RvmSerializedDb_ns_ShaderStreamableTexture {
    pub tex_coords_per_meter: f32,
    pub unk1: u16,
    pub texture_type: u16,
    pub name_hash: u32,
    /// Guessing this has something to do with external since the non-externals have 0xFFFF here
    pub external_hash: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x6C42BB1C)]
pub struct RvmSerializedDb_ns_InstanceTableAssemblyData {
    pub data: [u8; 0x0C],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x7F39A7B4)]
pub struct RvmSerializedDb_ns_Float(f32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x85EA841F)]
pub struct RvmSerializedDb_ns_ShaderInstancingMethod(u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x921C7685)]
pub struct RvmSerializedDb_ns_ShaderRenderMode(u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x963FC9FC)]
pub struct RvmSerializedDb_ns_PrimitiveType(u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xAB211D82)]
pub struct RvmSerializedDb_ns_ShaderSkinningMethod(u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xB0BC3C22)]
pub struct RvmSerializedDb_ns_Uint32(u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xCBEB8BF2)]
pub struct RvmSerializedDb_ns_ShaderGeometrySpace(u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xD80E5015)]
pub struct RvmSerializedDb_ns_TableAssemblyData {
    pub data: [u8; 0x14],
}

#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xD946931E)]
pub struct RvmSerializedDb_ns_DepthBiasGroupData {
    #[serde_as(as = "Bytes")]
    pub data: [u8; 0x88],
}

rvm_boxed!(RvmSerializedDb_ns_DepthBiasGroupData);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xDF54A891)]
pub struct RvmSerializedDb_ns_IndexBufferFormat(u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xF004D71E)]
pub struct RvmSerializedDb_ns_QualityLevel(u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x024C0AA3)]
pub struct RvmSerializedDb_ns_PackLightMapWeightIntoInstanceInstructionData {
    pub data: [u8; 0x0C],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x30FEB5EB)]
pub struct RvmSerializedDb_ns_Dx11ViewStateInstructionData {
    pub data: [u8; 0x14],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x373F60B2)]
pub struct RvmLegacyInstructions_ns_LegacyInstructionData {
    pub data: [u8; 0x14],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x38349F07)]
pub struct RvmSerializedDb_ns_WriteOp {
    pub data: [u8; 8],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x3EC9F4C9)]
pub struct RvmSerializedDb_ns_CpuToGpuMatrixInstructionData {
    pub data: [u8; 8],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x3FFF936C)]
pub struct RvmSerializedDb_ns_LodFadeInstructionData {
    pub data: [u8; 0x14],
}

#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x48EF6EC8)]
pub struct RvmSerializedDb_ns_Dx11ShaderDispatchDrawInstructionData {
    #[serde_as(as = "Bytes")]
    pub data: [u8; 0x24],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x4CC78E74)]
pub struct RvmSerializedDb_ns_DefaultValueSimpleTexture {
    pub data: [u8; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x577F1194)]
pub struct RvmSerializedDb_ns_PreparedVertexStream {
    pub data: [u8; 0x0C],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x6034ECD0)]
pub struct RvmSerializedDb_ns_RvmContextSortKeyInfo {
    pub index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x64670697)]
pub struct RvmSerializedDb_ns_OffsetTranslationInMatrixInstructionData {
    pub data: [u8; 0x0C],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x6589C9E2)]
pub struct RvmSerializedDb_ns_RvmSlotHandle {
    pub unk1: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x8FD6EAC0)]
pub struct RvmSerializedDb_ns_VectorSubtractInstructionData {
    pub data: [u8; 0x0C],
}

#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xAFD54D5E)]
pub struct RvmSerializedDb_ns_TessellationParametersInstructionData {
    #[serde_as(as = "Bytes")]
    pub data: [u8; 0x38],
}

rvm_boxed!(RvmSerializedDb_ns_TessellationParametersInstructionData);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xB0BC3C64)]
pub struct RvmSerializedDb_ns_Uint16(u16);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xB1FA00E2)]
pub struct RvmSerializedDb_ns_DefaultValueZeroMem {
    pub data: [u8; 2],
}

#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xCBC56BCA)]
pub struct RvmSerializedDb_ns_Dx11LegacyDrawStateBuilderData {
    #[serde_as(as = "Bytes")]
    pub data: [u8; 0x54],
}

rvm_boxed!(RvmSerializedDb_ns_Dx11LegacyDrawStateBuilderData);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xE18E74EB)]
pub struct RvmSerializedDb_ns_DefaultValueSimpleBuffer {
    pub data: [u8; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0xFF1CDF1E)]
pub struct RvmSerializedDb_ns_SliceCountInstructionData {
    pub unk1: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x0D1CFA1B)]
pub struct RvmSerializedDb_ns_Uint8(u8);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x5AF184F7)]
pub struct RvmSerializedDb_ns_DefaultValueStructLegacyData {
    pub unk1: u8,
}

#[serde_as]
#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x602A31A0)]
pub struct RvmSerializedDb_ns_Dx11ByteCodeElement {
    #[serde_as(as = "Bytes")]
    pub data: [u8; 0x100],
}

rvm_boxed!(RvmSerializedDb_ns_Dx11ByteCodeElement);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x685C8B18)]
pub struct RvmSerializedDb_ns_WriteOpGroup {
    pub unk1: [u8; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x7C70E6DD)]
pub struct RvmSerializedDb_ns_Char(u8);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x920A778E)]
pub struct RvmSerializedDb_ns_BaseShaderState {
    pub data: [u8; 6],
}

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(0x9638B221)]
pub struct RvmSerializedDb_ns_Boolean(pub bool);

// RVM NV (NVidia?) Types

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeInfo)]
#[repr(C)]
#[hash(2051034773)]
pub struct RvmSerializedDb_ns_NvShadowMapRenderType(pub u32);

#[derive(Debug, Clone, Serialize, Deserialize, RvmTypeEnum, IntoStaticStr)]
pub enum RvmType {
    Dx11SerializedBlendState(RvmSerializedDb_ns_Dx11SerializedBlendStateBoxed),
    Vec(RvmSerializedDb_ns_Vec),
    LegacyLightMapInstance(RvmLegacyLightMapInstance),
    Dx11VsShader(RvmSerializedDb_ns_Dx11VsShader),
    SerializedParamDbKey(RvmSerializedDb_ns_SerializedParamDbKey),
    ProjectionState(RvmSerializedDb_ns_ProjectionStateBoxed),
    StencilState(RvmSerializedDb_ns_StencilState),
    Dx11Sampler(RvmSerializedDb_ns_Dx11SamplerBoxed),
    LegacyLightProbes(RvmLegacyLightProbesBoxed),
    ViewState(RvmSerializedDb_ns_ViewStateBoxed),
    DefaultValueRef(RvmSerializedDb_ns_DefaultValueRef),
    InstructionBatchRef(RvmSerializedDb_ns_InstructionBatchRef),
    Dx11ApplyParametersBlock(RvmSerializedDb_ns_Dx11ApplyParametersBlock),
    RvmPermutation(RvmSerializedDb_ns_RvmPermutation),
    Int64(RvmSerializedDb_ns_Int64),
    InstructionBatch(RvmSerializedDb_ns_InstructionBatch),
    RvmFunction(RvmSerializedDb_ns_RvmFunction),
    InstanceTableAssemblyInstructionBatchData(
        RvmSerializedDb_ns_InstanceTableAssemblyInstructionBatchData,
    ),
    SurfaceShader(RvmSerializedDb_ns_SurfaceShader),
    Dx11LegacyVertexBufferConversionInstructionData(
        RvmSerializedDb_ns_Dx11LegacyVertexBufferConversionInstructionData,
    ),
    SerializedParameterBlock(RvmSerializedDb_ns_SerializedParameterBlock),
    RvmFunctionInputTableIndices(RvmSerializedDb_ns_RvmFunctionInputTableIndices),
    Dx11PsShader(RvmSerializedDb_ns_Dx11PsShader),
    Dx11HsShader(RvmSerializedDb_ns_Dx11HsShader),
    SerializedParameterBlockRef(RvmSerializedDb_ns_SerializedParameterBlockRef),
    Dx11BlendStateData(RvmSerializedDb_ns_Dx11BlendStateDataBoxed),
    DirectInputInstructionData(RvmSerializedDb_ns_DirectInputInstructionData),
    Dx11TextureConversionInstructionData(RvmSerializedDb_ns_Dx11TextureConversionInstructionData),
    Dx11DsShader(RvmSerializedDb_ns_Dx11DsShader),
    ValueRef(RvmSerializedDb_ns_ValueRef),
    RvmPermutationRef(RvmSerializedDb_ns_RvmPermutationRef),
    RvmPermutationSet(RvmSerializedDb_ns_RvmPermutationSet),
    ShaderStreamableTextureRef(RvmSerializedDb_ns_ShaderStreamableTextureRef),
    ParamDbSerializedHashView(RvmSerializedDb_ns_ParamDbSerializedHashView),
    RvmDispatch(RvmSerializedDb_ns_RvmDispatch),
    RvmFunctionInstance(RvmSerializedDb_ns_RvmFunctionInstance),
    ParamDbSerializedHashViewRef(RvmSerializedDb_ns_ParamDbSerializedHashViewRef),
    ParamDbSerializedFilterView(RvmSerializedDb_ns_ParamDbSerializedFilterView),
    RuntimeInstantiatedType(RvmSerializedDb_ns_RuntimeInstantiatedType),
    Dx11InputElement(RvmSerializedDb_ns_Dx11InputElement),
    CombinedSerializedParameterBlock(RvmSerializedDb_ns_CombinedSerializedParameterBlock),
    ParamDbSerializedReadView(RvmSerializedDb_ns_ParamDbSerializedReadView),
    Dx11ApplyParametersInstructionData(RvmSerializedDb_ns_Dx11ApplyParametersInstructionData),
    RvmFunctionInstanceRef(RvmSerializedDb_ns_RvmFunctionInstanceRef),
    ParamDbHash(RvmSerializedDb_ns_ParamDbHash),
    Dx11BufferConversionInstructionData(RvmSerializedDb_ns_Dx11BufferConversionInstructionData),
    Settings(RvmSerializedDb_ns_Settings),
    ShaderStreamableExternalTextureRef(RvmSerializedDb_ns_ShaderStreamableExternalTextureRef),
    Dx11DispatchInstructionData(RvmSerializedDb_ns_Dx11DispatchInstructionData),
    ParamDbKeyRef(RvmSerializedDb_ns_ParamDbKeyRef),
    RttiType(RvmSerializedDb_ns_RttiType),
    TableAssemblyInstructionBatchData(RvmSerializedDb_ns_TableAssemblyInstructionBatchData),
    RvmPermutationLookupTable(RvmSerializedDb_ns_RvmPermutationLookupTable),
    Int32(RvmSerializedDb_ns_Int32),
    ShaderDepthBiasGroup(RvmSerializedDb_ns_ShaderDepthBiasGroup),
    ShaderStreamableExternalTexture(RvmSerializedDb_ns_ShaderStreamableExternalTexture),
    RenderDepthMode(RvmSerializedDb_ns_RenderDepthMode),
    RvmLegacyOutdoorLightStatus(RvmSerializedDb_ns_RvmLegacyOutdoorLightStatus),
    RvmLevelOfDetail(RvmSerializedDb_ns_RvmLevelOfDetail),
    ShaderStreamableTexture(RvmSerializedDb_ns_ShaderStreamableTexture),
    InstanceTableAssemblyData(RvmSerializedDb_ns_InstanceTableAssemblyData),
    Float32(RvmSerializedDb_ns_Float),
    ShaderInstancingMethod(RvmSerializedDb_ns_ShaderInstancingMethod),
    ShaderRenderMode(RvmSerializedDb_ns_ShaderRenderMode),
    PrimitiveType(RvmSerializedDb_ns_PrimitiveType),
    ShaderSkinningMethod(RvmSerializedDb_ns_ShaderSkinningMethod),
    Uint32(RvmSerializedDb_ns_Uint32),
    ShaderGeometrySpace(RvmSerializedDb_ns_ShaderGeometrySpace),
    TableAssemblyData(RvmSerializedDb_ns_TableAssemblyData),
    DepthBiasGroupData(RvmSerializedDb_ns_DepthBiasGroupDataBoxed),
    IndexBufferFormat(RvmSerializedDb_ns_IndexBufferFormat),
    QualityLevel(RvmSerializedDb_ns_QualityLevel),
    PackLightMapWeightIntoInstanceInstructionData(
        RvmSerializedDb_ns_PackLightMapWeightIntoInstanceInstructionData,
    ),
    Dx11ViewStateInstructionData(RvmSerializedDb_ns_Dx11ViewStateInstructionData),
    LegacyInstructionData(RvmLegacyInstructions_ns_LegacyInstructionData),
    WriteOp(RvmSerializedDb_ns_WriteOp),
    CpuToGpuMatrixInstructionData(RvmSerializedDb_ns_CpuToGpuMatrixInstructionData),
    LodFadeInstructionData(RvmSerializedDb_ns_LodFadeInstructionData),
    Dx11ShaderDispatchDrawInstructionData(RvmSerializedDb_ns_Dx11ShaderDispatchDrawInstructionData),
    DefaultValueSimpleTexture(RvmSerializedDb_ns_DefaultValueSimpleTexture),
    PreparedVertexStream(RvmSerializedDb_ns_PreparedVertexStream),
    RvmContextSortKeyInfo(RvmSerializedDb_ns_RvmContextSortKeyInfo),
    OffsetTranslationInMatrixInstructionData(
        RvmSerializedDb_ns_OffsetTranslationInMatrixInstructionData,
    ),
    RvmSlotHandle(RvmSerializedDb_ns_RvmSlotHandle),
    VectorSubtractInstructionData(RvmSerializedDb_ns_VectorSubtractInstructionData),
    TessellationParametersInstructionData(
        RvmSerializedDb_ns_TessellationParametersInstructionDataBoxed,
    ),
    Uint16(RvmSerializedDb_ns_Uint16),
    DefaultValueZeroMem(RvmSerializedDb_ns_DefaultValueZeroMem),
    Dx11LegacyDrawStateBuilderData(RvmSerializedDb_ns_Dx11LegacyDrawStateBuilderDataBoxed),
    DefaultValueSimpleBuffer(RvmSerializedDb_ns_DefaultValueSimpleBuffer),
    SliceCountInstructionData(RvmSerializedDb_ns_SliceCountInstructionData),
    Uint8(RvmSerializedDb_ns_Uint8),
    DefaultValueStructLegacyData(RvmSerializedDb_ns_DefaultValueStructLegacyData),
    Dx11ByteCodeElement(RvmSerializedDb_ns_Dx11ByteCodeElementBoxed),
    WriteOpGroup(RvmSerializedDb_ns_WriteOpGroup),
    Char(RvmSerializedDb_ns_Char),
    BaseShaderState(RvmSerializedDb_ns_BaseShaderState),
    Boolean(RvmSerializedDb_ns_Boolean),
    // RVM NV Types
    NvShadowMapRenderType(RvmSerializedDb_ns_NvShadowMapRenderType),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_boxed_equality() {
        assert_eq!(
            RvmSerializedDb_ns_Dx11SerializedBlendStateBoxed::data_size(),
            RvmSerializedDb_ns_Dx11SerializedBlendState::data_size()
        );

        assert_eq!(
            RvmType::hash_to_size(RvmSerializedDb_ns_Dx11SerializedBlendState::hash()).unwrap(),
            RvmSerializedDb_ns_Dx11SerializedBlendState::data_size()
        );
    }
}
