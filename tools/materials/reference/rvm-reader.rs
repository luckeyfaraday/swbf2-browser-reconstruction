use std::{
    collections::{HashMap, HashSet},
    hash::Hasher,
    io::SeekFrom,
    mem,
};

use cityhash_sys::city_hash_64_with_seed;
use cityhasher::CityHasher;
use glacier_buf_ext::util::GuidAsyncReadExt;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeek, AsyncSeekExt, BufReader};

use crate::rvm::types::RvmSerializedDb_ns_Boolean;

use super::{
    types::{
        RvmSerializedDb_ns_CombinedSerializedParameterBlock, RvmSerializedDb_ns_DefaultValueRef, RvmSerializedDb_ns_DirectInputInstructionData, RvmSerializedDb_ns_Dx11ApplyParametersBlock, RvmSerializedDb_ns_Dx11ApplyParametersInstructionData, RvmSerializedDb_ns_Dx11BlendStateData, RvmSerializedDb_ns_Dx11BlendStateDataBoxed, RvmSerializedDb_ns_Dx11BufferConversionInstructionData, RvmSerializedDb_ns_Dx11DispatchInstructionData, RvmSerializedDb_ns_Dx11DsShader, RvmSerializedDb_ns_Dx11HsShader, RvmSerializedDb_ns_Dx11InputElement, RvmSerializedDb_ns_Dx11LegacyVertexBufferConversionInstructionData, RvmSerializedDb_ns_Dx11PsShader, RvmSerializedDb_ns_Dx11TextureConversionInstructionData, RvmSerializedDb_ns_Dx11VsShader, RvmSerializedDb_ns_InstanceTableAssemblyInstructionBatchData, RvmSerializedDb_ns_InstructionBatch, RvmSerializedDb_ns_InstructionBatchRef, RvmSerializedDb_ns_ParamDbKeyRef, RvmSerializedDb_ns_ParamDbSerializedHashView, RvmSerializedDb_ns_ParamDbSerializedHashViewRef, RvmSerializedDb_ns_ParamDbSerializedReadView, RvmSerializedDb_ns_RttiType, RvmSerializedDb_ns_RuntimeInstantiatedType, RvmSerializedDb_ns_RvmDispatch, RvmSerializedDb_ns_RvmFunction, RvmSerializedDb_ns_RvmFunctionInputTableIndices, RvmSerializedDb_ns_RvmFunctionInstance, RvmSerializedDb_ns_RvmFunctionInstanceRef, RvmSerializedDb_ns_RvmPermutation, RvmSerializedDb_ns_RvmPermutationRef, RvmSerializedDb_ns_RvmPermutationSet, RvmSerializedDb_ns_SerializedParameterBlock, RvmSerializedDb_ns_SerializedParameterBlockRef, RvmSerializedDb_ns_Settings, RvmSerializedDb_ns_ShaderStreamableExternalTextureRef, RvmSerializedDb_ns_ShaderStreamableTextureRef, RvmSerializedDb_ns_SurfaceShader, RvmSerializedDb_ns_TableAssemblyInstructionBatchData, RvmSerializedDb_ns_ValueRef, RvmType
    },
    RvmTypeDatabase,
};

#[derive(thiserror::Error, Debug)]
pub enum RvmReaderError {
    #[error("io error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("int parse error: {0}")]
    ParseIntError(#[from] std::num::ParseIntError),
    #[error("bool parse error: {0}")]
    ParseBoolError(#[from] std::str::ParseBoolError),
    #[error("float parse error: {0}")]
    ParseFloatError(#[from] std::num::ParseFloatError),
    #[error("invalid type: {0}")]
    InvalidType(u32),
    #[error("file not found")]
    FileNotFound,
}

#[derive(Debug, Default, Clone)]
#[repr(C)]
struct RvmHeaderType {
    name_hash: u32,
    count: u32,
    index: u64,
}

fn hash_from_binary(hash: u64) -> u64 {
    u64::from_be(hash & 0x000000ffffffffff)
}

pub struct RvmDatabaseReader<W: AsyncRead + AsyncSeek + Unpin> {
    reader: BufReader<W>,
}

impl<W: AsyncRead + AsyncSeek + Unpin> RvmDatabaseReader<W> {
    pub fn new(reader: W) -> Self {
        Self {
            reader: BufReader::new(reader),
        }
    }

    pub async fn read(mut self) -> Result<RvmTypeDatabase, RvmReaderError> {
        let maybe_version = self.reader.read_u32_le().await?;
        let offset = self.reader.read_u32_le().await?;
        let size = self.reader.read_u32_le().await?;
        let maybe_hash = self.reader.read_u32_le().await?;

        self.reader
            .seek(SeekFrom::Start(0x10 + offset as u64))
            .await?;
        let guid = self.reader.read_guid().await?;
        let hash = self.reader.read_u64_le().await?;

        let _unk1 = self.reader.read_u32_le().await?;
        let counts_len = self.reader.read_u32_le().await?;
        let _unk3 = self.reader.read_u32_le().await?;
        let _unk4 = self.reader.read_u16_le().await?;

        let type_count = self.reader.read_u16_le().await?;
        let header_types = self.read_header_types(type_count).await?;

        let _unk6 = self.reader.read_u64_le().await?;

        let mut block_counts = Vec::with_capacity(counts_len as usize);
        for _ in 0..counts_len {
            let count = self.reader.read_u16_le().await?;
            block_counts.push(count);
        }

        self.reader.seek(SeekFrom::Start(0x10)).await?;
        let db = self.read_blocks(&header_types, &block_counts).await?;

        Ok(db)
    }

    async fn read_header_types(
        &mut self,
        count: u16,
    ) -> Result<Vec<RvmHeaderType>, RvmReaderError> {
        let mut data = vec![0u8; mem::size_of::<RvmHeaderType>() * count as usize];
        self.reader.read_exact(&mut data).await?;

        let mut types = vec![RvmHeaderType::default(); count as usize];
        unsafe {
            std::ptr::copy_nonoverlapping(data.as_ptr(), types.as_mut_ptr() as *mut u8, data.len());
        }

        Ok(types)
    }

    async fn read_blocks(
        &mut self,
        header_types: &[RvmHeaderType],
        block_counts: &[u16],
    ) -> Result<RvmTypeDatabase, RvmReaderError> {
        let mut db = RvmTypeDatabase::new();

        println!("Size of RvmType: {}", std::mem::size_of::<RvmType>());

        let mut inner_count = 0;
        for header_type in header_types {
            let hash = header_type.name_hash;

            let size = match RvmType::hash_to_size(hash) {
                Some(size) => size,
                None => return Err(RvmReaderError::InvalidType(hash)),
            };

            let mut last_block_hash = 0;
            let mut last_block_name = "";

            for _ in 0..header_type.count {
                let block_count = block_counts[inner_count] as usize;
                let mut block_data = Vec::with_capacity(block_count * size);
                let mut block = Vec::with_capacity(block_count);

                for _ in 0..block_count {
                    let mut data = vec![0u8; size];
                    self.reader.read_exact(&mut data).await?;

                    let rvm_type = RvmType::from_slice(hash, &data).unwrap();
                    last_block_name = (&rvm_type).into();

                    block.push(rvm_type);
                    block_data.extend_from_slice(&data);
                }

                //block_data.shrink_to_fit();
                //block.shrink_to_fit();

                // let mut hasher = CityHasher::with_seed(hash as u64);
                // hasher.write(&block_data);
                // let block_hash = hash_from_binary(hasher.finish());

                let block_hash = hash_from_binary(city_hash_64_with_seed(&block_data, hash as u64));
                db.add_block(hash, block_hash, block);

                last_block_hash = block_hash;

                inner_count += 1;
            }

            //println!("Read {}: {:#x}", last_block_name, last_block_hash);

            //tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }

        println!("Read {}/{} blocks", inner_count, block_counts.len());

        Ok(db)
    }
}

trait RvmDependencyVisitor {
    fn visit(&self, db: &RvmTypeDatabase, out: &mut Vec<u64>);
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_SurfaceShader {
    fn visit(&self, db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.shared_streamable_texture_ref));
        out.push(hash_from_binary(
            self.shader_streamable_external_texture_ref,
        ));
        out.push(hash_from_binary(self.hash3));
        out.push(hash_from_binary(self.hash4));

        let permutations = db.get_blocks_of_type(RvmSerializedDb_ns_RvmPermutationSet::hash());
        for permutation_key in permutations {
            let block = db.get_block(permutation_key).expect(&format!(
                "Failed to find RvmPermutationSet for SurfaceShader {:?}",
                self.guid
            ));

            for permutation in block {
                if let RvmType::RvmPermutationSet(permutation) = permutation {
                    if permutation.guid == self.guid {
                        out.push(permutation_key);
                        return;
                    }
                }
            }
        }

        panic!(
            "Failed to find RvmPermutationSet for SurfaceShader {:?}",
            self.guid
        );
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_RvmPermutationSet {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.permutation_ref));
        out.push(hash_from_binary(self.permutation_lookup_table));
        out.push(hash_from_binary(self.param_db_hash));
        out.push(hash_from_binary(self.hash4));
        out.push(hash_from_binary(self.unk6));
        out.push(hash_from_binary(self.unk7));
        out.push(hash_from_binary(self.unk8));
        out.push(hash_from_binary(self.hash5));
        out.push(hash_from_binary(self.param_db_serialized_hash_view_ref));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_RvmPermutationRef {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_RvmPermutation {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.rvm_function_instance_ref));
        out.push(hash_from_binary(self.rvm_context_sort_key_info));
        out.push(hash_from_binary(self.hash3));
        out.push(hash_from_binary(self.rvm_dispatch));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_RvmFunctionInstanceRef {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_RvmFunctionInstance {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.unk1));
        out.push(hash_from_binary(self.unk2));
        out.push(hash_from_binary(self.combined_serialized_parameter_block));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_RvmFunctionInputTableIndices {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_RvmFunction {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.instruction_batch_ref));
        out.push(hash_from_binary(self.param_db_serialized_hash_view));
        out.push(hash_from_binary(self.param_db_serialized_filter_view));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_ShaderStreamableTextureRef {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_ShaderStreamableExternalTextureRef {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_ParamDbSerializedHashViewRef {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_ParamDbSerializedHashView {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.param_db_key_ref));
        out.push(hash_from_binary(self.param_db_key_ref2));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_ParamDbKeyRef {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_SerializedParameterBlock {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.param_db_key_ref));
        out.push(hash_from_binary(self.hash1));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_DefaultValueRef {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_ValueRef {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Dx11PsShader {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.unk1));
        out.push(hash_from_binary(self.dx11_byte_code_element));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Dx11DsShader {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.unk1));
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Dx11VsShader {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.dx11_byte_code_element));
        out.push(hash_from_binary(self.dx11_input_element));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Dx11HsShader {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Dx11InputElement {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.semantic_name));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_RuntimeInstantiatedType {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.rtti_type));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_RttiType {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.module_name));
        out.push(hash_from_binary(self.name));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_RvmDispatch {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.instruction_batch_ref));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_InstructionBatchRef {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_InstructionBatch {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.runtime_instantiated_type));
        out.push(hash_from_binary(self.instruction_ref));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_InstanceTableAssemblyInstructionBatchData {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.table_assembly_data));
        out.push(hash_from_binary(self.write_op));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_TableAssemblyInstructionBatchData {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.table_assembly_data));
        out.push(hash_from_binary(self.hash1));
        out.push(hash_from_binary(self.write_op_group));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_CombinedSerializedParameterBlock {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash1));
        out.push(hash_from_binary(self.hash2));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Dx11ApplyParametersInstructionData {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash1));
        out.push(hash_from_binary(self.hash2));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_DirectInputInstructionData {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.param_db_serialized_read_view));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Dx11BlendStateDataBoxed {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        for hash_bytes in self.0.dx11_serialized_blend_states.chunks(8) {
            let hash = u64::from_le_bytes(hash_bytes.try_into().unwrap());
            out.push(hash_from_binary(hash));
        }
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Dx11LegacyVertexBufferConversionInstructionData {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.prepared_vertex_stream));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Settings {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.database_name));
        out.push(hash_from_binary(self.hash1));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_SerializedParameterBlockRef {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.hash));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Dx11TextureConversionInstructionData {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.rvm_slot_handle1));
        out.push(hash_from_binary(self.rvm_slot_handle2));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_ParamDbSerializedReadView {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.param_db_key_ref));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Dx11BufferConversionInstructionData {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.rvm_slot_handle1));
        out.push(hash_from_binary(self.rvm_slot_handle2));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Dx11DispatchInstructionData {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.rvm_slot_handle1));
        out.push(hash_from_binary(self.rvm_slot_handle2));
    }
}

impl RvmDependencyVisitor for RvmSerializedDb_ns_Dx11ApplyParametersBlock {
    fn visit(&self, _db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        out.push(hash_from_binary(self.rvm_slot_handle));
    }
}

impl RvmDependencyVisitor for RvmType {
    fn visit(&self, db: &RvmTypeDatabase, out: &mut Vec<u64>) {
        match self {
            RvmType::SurfaceShader(value) => value.visit(db, out),
            RvmType::RvmPermutationSet(value) => value.visit(db, out),
            RvmType::RvmPermutationRef(value) => value.visit(db, out),
            RvmType::RvmPermutation(value) => value.visit(db, out),
            RvmType::RvmFunctionInstanceRef(value) => value.visit(db, out),
            RvmType::RvmFunctionInstance(value) => value.visit(db, out),
            RvmType::RvmFunctionInputTableIndices(value) => value.visit(db, out),
            RvmType::RvmFunction(value) => value.visit(db, out),
            RvmType::ShaderStreamableTextureRef(value) => value.visit(db, out),
            RvmType::ShaderStreamableExternalTextureRef(value) => value.visit(db, out),
            RvmType::ParamDbSerializedHashView(value) => value.visit(db, out),
            RvmType::ParamDbSerializedHashViewRef(value) => value.visit(db, out),
            RvmType::ParamDbKeyRef(value) => value.visit(db, out),
            RvmType::SerializedParameterBlock(value) => value.visit(db, out),
            RvmType::DefaultValueRef(value) => value.visit(db, out),
            RvmType::ValueRef(value) => value.visit(db, out),
            RvmType::Dx11PsShader(value) => value.visit(db, out),
            RvmType::Dx11DsShader(value) => value.visit(db, out),
            RvmType::Dx11VsShader(value) => value.visit(db, out),
            RvmType::Dx11HsShader(value) => value.visit(db, out),
            RvmType::Dx11InputElement(value) => value.visit(db, out),
            RvmType::RuntimeInstantiatedType(value) => value.visit(db, out),
            RvmType::RttiType(value) => value.visit(db, out),
            RvmType::RvmDispatch(value) => value.visit(db, out),
            RvmType::InstructionBatchRef(value) => value.visit(db, out),
            RvmType::InstructionBatch(value) => value.visit(db, out),
            RvmType::InstanceTableAssemblyInstructionBatchData(value) => value.visit(db, out),
            RvmType::TableAssemblyInstructionBatchData(value) => value.visit(db, out),
            RvmType::CombinedSerializedParameterBlock(value) => value.visit(db, out),
            RvmType::Dx11ApplyParametersInstructionData(value) => value.visit(db, out),
            RvmType::DirectInputInstructionData(value) => value.visit(db, out),
            RvmType::Dx11BlendStateData(value) => value.visit(db, out),
            RvmType::Dx11LegacyVertexBufferConversionInstructionData(value) => value.visit(db, out),
            RvmType::Settings(value) => value.visit(db, out),
            RvmType::SerializedParameterBlockRef(value) => value.visit(db, out),
            RvmType::Dx11TextureConversionInstructionData(value) => value.visit(db, out),
            RvmType::ParamDbSerializedReadView(value) => value.visit(db, out),
            RvmType::Dx11BufferConversionInstructionData(value) => value.visit(db, out),
            RvmType::Dx11DispatchInstructionData(value) => value.visit(db, out),
            RvmType::Dx11ApplyParametersBlock(value) => value.visit(db, out),
            _ => {}
        }
    }
}

struct RvmDependencyCollector {
    block_dependencies: HashMap<u64, HashSet<u64>>,
    type_dependencies: HashMap<&'static str, HashSet<&'static str>>,
    type_names: HashSet<&'static str>,
}

impl RvmDependencyCollector {
    fn new() -> Self {
        Self {
            block_dependencies: HashMap::new(),
            type_dependencies: HashMap::new(),
            type_names: HashSet::new(),
        }
    }

    fn collect(&mut self, db: &RvmTypeDatabase) {
        for entry in db.entries() {
            let mut block_dependencies = Vec::new();
            let mut type_name = "";

            for rvm_type in entry.1 {
                rvm_type.visit(&db, &mut block_dependencies);
                type_name = rvm_type.into();
            }

            self.type_names.insert(type_name);

            if block_dependencies.is_empty() {
                continue;
            }

            // println!(
            //     "Block is a {} with {} dependencies",
            //     type_name,
            //     block_dependencies.len()
            // );

            let block_map = self.block_dependencies.entry(*entry.0).or_default();
            let type_map = self.type_dependencies.entry(type_name).or_default();

            for dependency in &block_dependencies {
                if dependency == &0 {
                    //println!("  - 0");
                    continue;
                }

                //println!("  - {:#x}", dependency);
                block_map.insert(*dependency);

                let dependency_type = db
                    .get_block(*dependency)
                    .expect("Failed to get block for dependency")
                    .first()
                    .unwrap()
                    .into();
                type_map.insert(dependency_type);
            }
        }
    }

    pub fn type_dependencies(&self) -> &HashMap<&'static str, HashSet<&'static str>> {
        &self.type_dependencies
    }

    pub fn type_names(&self) -> &HashSet<&'static str> {
        &self.type_names
    }
}

pub struct RvmDependencyTraverser<'a> {
    db: &'a RvmTypeDatabase,
}

impl<'a> RvmDependencyTraverser<'a> {
    pub fn new(db: &'a RvmTypeDatabase) -> Self {
        Self { db }
    }

    pub fn traverse(&self, root_type: u32) -> HashMap<u64, HashSet<u64>> {
        let mut visited = HashMap::new();

        let root_blocks = self.db.get_blocks_of_type(root_type);
        for block_hash in root_blocks {
            let dependencies = self.traverse_block(block_hash);
            visited.insert(block_hash, dependencies);
        }

        visited
    }

    fn traverse_block(&self, block_hash: u64) -> HashSet<u64> {
        let mut visited = HashSet::new();
        let mut stack = vec![block_hash];

        while let Some(hash) = stack.pop() {
            if hash == 0 || !visited.insert(hash) {
                continue;
            }

            let block = self.db.get_block(hash).unwrap();
            for rvm_type in block {
                rvm_type.visit(&self.db, &mut stack);
            }
        }

        visited
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use glacier_reflect::type_registry::TypeRegistry;
    use glacier_reflect_swbf2::register_mod_types;

    use crate::rvm;

    use super::*;

    #[tokio::test]
    async fn read_rvm_database() {
        let data = include_bytes!("../../tests/data/rvmdatabase_dx11rvmdatabase.res");

        // let reader = RvmDatabaseReader::new(Cursor::new(data.to_vec()));
        // let db = reader.read().await.unwrap();

        let reader = RvmDatabaseReader::new(Cursor::new(data.to_vec()));
        let db = reader.read().await.unwrap();

        println!("Read database, resolving dependencies...");

        let traverser = RvmDependencyTraverser::new(&db);
        let shaders = traverser.traverse(RvmSerializedDb_ns_SurfaceShader::hash());

        let mut all_visited_blocks = HashSet::new();
        for (_shader_hash, visited_blocks) in shaders {
            //println!("Shader {:#x} has {} dependencies", shader_hash, visited_blocks.len());
            all_visited_blocks.extend(visited_blocks);
        }

        println!("Visited {} blocks", all_visited_blocks.len());

        let mut type_counts = HashMap::new();
        for (_, block) in db.entries() {
            let type_name: &'static str = block.first().unwrap().into();
            let count = type_counts.entry(type_name).or_insert(0);
            *count += 1;
        }

        // Collect all non-visited blocks
        let all_blocks = db.entries().map(|(hash, _)| *hash).collect::<HashSet<_>>();
        let non_visited_blocks = all_blocks
            .difference(&all_visited_blocks)
            .collect::<Vec<_>>();

        println!(
            "Non-visited blocks: {}/{}",
            non_visited_blocks.len(),
            all_blocks.len()
        );

        // Map non-visited blocks to their types
        let mut non_visited_types = HashMap::new();
        for block_hash in non_visited_blocks {
            let block = db.get_block(*block_hash).unwrap();
            let type_name: &'static str = block.first().unwrap().into();

            if type_name == "RvmSlotHandle" {
                println!("{:#x}", block_hash);
            }

            let count = non_visited_types.entry(type_name).or_insert(0);
            *count += 1;
        }

        for (type_name, count) in non_visited_types {
            println!(
                "{}: {}/{}",
                type_name,
                count,
                type_counts.get(type_name).unwrap()
            );
        }

        println!("Done, running collector...");

        let mut collector = RvmDependencyCollector::new();
        collector.collect(&db);

        let mut registry = TypeRegistry::default();
        register_mod_types(&mut registry);

        let mut touched_names = HashSet::new();

        let type_dependencies = collector.type_dependencies();
        for (type_hash, dependencies) in type_dependencies {
            // let type_info = registry.type_by_hash(*type_hash).unwrap();
            // let dependencies = dependencies
            //     .iter()
            //     .map(|hash| registry.type_by_hash(*hash).unwrap().name)
            //     .collect::<Vec<_>>();
            let dependencies = dependencies.iter().map(|hash| *hash).collect::<Vec<_>>();

            touched_names.insert(*type_hash);
            for dependency in &dependencies {
                touched_names.insert(*dependency);
            }

            println!("{} depends on {}", type_hash, dependencies.join(", "));
        }

        for type_name in collector.type_names() {
            if touched_names.contains(type_name) {
                continue;
            }

            println!("Nothing depends on {}", type_name);
        }

        // let blocks = db.get_blocks_of_type(0x7B05F918);
        // for block_hash in blocks {
        //     let block = db.get_block(block_hash).unwrap();
        //     for rvm_type in block {
        //         println!("{:#x}: {}", block_hash, rvm_type.to_slice().len());

        //         // if let RvmType::RvmPermutationSet(set) = rvm_type {
        //         //     println!("{:#x}", hash_from_binary(set.permutation_ref));
        //         // }
        //     }
        // }
    }
}
