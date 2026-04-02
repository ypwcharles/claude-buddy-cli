#include <stdint.h>
#include "wyhash.h"

// 预计算的 Hex 表
static const uint8_t HEX_CHARS[16] = "0123456789abcdef";
static uint8_t HEX_TABLE_INIT = 0;
static uint32_t HEX16[65536];

static inline void init_hex_table() {
    if (HEX_TABLE_INIT) return;
    for (uint32_t i = 0; i < 65536; i++) {
        uint8_t a = HEX_CHARS[(i >> 12) & 0xf];
        uint8_t b = HEX_CHARS[(i >> 8) & 0xf];
        uint8_t c = HEX_CHARS[(i >> 4) & 0xf];
        uint8_t d = HEX_CHARS[i & 0xf];
#if __BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__
        HEX16[i] = a | (b << 8) | (c << 16) | (d << 24);
#else
        HEX16[i] = d | (c << 8) | (b << 16) | (a << 24);
#endif
    }
    HEX_TABLE_INIT = 1;
}

// 高速填充 [56..63] 这个 8 字节区间
static inline void write_suffix_hex(uint8_t *bytes, uint32_t suffix) {
    uint32_t high = suffix >> 16;
    uint32_t low = suffix & 0xffff;
    *((uint32_t*)(bytes + 56)) = HEX16[high];
    *((uint32_t*)(bytes + 60)) = HEX16[low];
}

// 目标匹配单一 Target Seed
int64_t scan_single_target(
    uint8_t *prefix_buf, 
    uint32_t length,
    uint32_t target_seed, 
    uint64_t start_suffix, 
    uint64_t end_suffix, 
    volatile int32_t *state
) {
    init_hex_table();
    
    // 使用线程本地 buffer 副本避免跨线程竞争
    uint8_t local_buf[128];
    for (uint32_t i = 0; i < length; i++) local_buf[i] = prefix_buf[i];

    for (uint64_t raw = start_suffix; raw < end_suffix; raw++) {
        uint32_t suffix = (uint32_t)raw;
        // 定期检查上层 JS `Atomics.load(state, 0)` 是否有并发线程已命中退出
        if ((suffix & 1023) == 0 && state != 0 && __atomic_load_n(state, __ATOMIC_RELAXED) != 0) {
            return -1; // 被其他线程中断
        }

        write_suffix_hex(local_buf, suffix);

        // wyhash 计算 (Bun/Zig 内部的 V3 特定版本行为通过 _wyp 和 seed=0 完全1对1复刻)
        uint64_t h = wyhash(local_buf, length, 0, _wyp);
        uint32_t candidate_seed = (uint32_t)(h & 0xffffffff);

        if (candidate_seed == target_seed) {
            if (state != 0) {
                int32_t expected = 0;
                if (__atomic_compare_exchange_n(state, &expected, 1, 0, __ATOMIC_RELAXED, __ATOMIC_RELAXED)) {
                    state[2] = suffix;
                    __atomic_store_n(state + 0, 1, __ATOMIC_RELAXED);
                }
            }
            return suffix;
        }
    }
    return -1;
}

// 目标匹配多个 Target Seeds 集合
int64_t scan_set_target(
    uint8_t* prefix_buf,
    uint32_t length,
    uint32_t* target_seeds,
    uint32_t seed_count,
    uint64_t start_suffix,
    uint64_t end_suffix,
    volatile int32_t* state,
    uint32_t* matched_seed_out
) {
    init_hex_table();
    uint8_t local_buf[128];
    for(uint32_t i=0; i<length; i++) local_buf[i] = prefix_buf[i];

    for (uint64_t raw = start_suffix; raw < end_suffix; raw++) {
        uint32_t suffix = (uint32_t)raw;
        if ((suffix & 1023) == 0 && state != 0 && __atomic_load_n(state, __ATOMIC_RELAXED) != 0) {
            return -1;
        }

        write_suffix_hex(local_buf, suffix);
        uint64_t h = wyhash(local_buf, length, 0, _wyp);
        uint32_t candidate_seed = (uint32_t)(h & 0xffffffff);

        int found = 0;
        // Seed count 极小，线性搜索是最快且无缓存失效开销的
        for (uint32_t i = 0; i < seed_count; i++) {
            if (candidate_seed == target_seeds[i]) {
                found = 1;
                if (matched_seed_out) *matched_seed_out = candidate_seed;
                break;
            }
        }
        
        if (found) {
            if (state != 0) {
                int32_t expected = 0;
                if (__atomic_compare_exchange_n(state, &expected, 1, 0, __ATOMIC_RELAXED, __ATOMIC_RELAXED)) {
                    state[2] = suffix;
                    state[3] = candidate_seed;
                    __atomic_store_n(state + 0, 1, __ATOMIC_RELAXED);
                }
            }
            return suffix;
        }
    }
    return -1;
}
