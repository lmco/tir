<template>
  <div>
    <button
      v-if="asIcon"
      type="button"
      title="Remove provider"
      class="inline-flex items-center justify-center rounded-md p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-red-400"
      @click="open = true"
    >
      <TrashIcon class="h-4 w-4" />
    </button>
    <button
      v-else
      type="button"
      class="inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold text-red-600 ring-1 ring-inset ring-red-300 transition hover:bg-red-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 dark:text-red-400 dark:ring-red-500/40 dark:hover:bg-red-500/10 dark:focus-visible:ring-offset-gray-800"
      @click="open = true"
    >
      <TrashIcon class="h-4 w-4" />
      Remove
    </button>

    <ModalDialog
      :show="open"
      :title="`Remove ${name}?`"
      message="Users who sign in through this provider will no longer be able to sign in once the change is saved."
      confirm-text="Remove"
      danger
      @confirm="confirm"
      @cancel="open = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { TrashIcon } from "@heroicons/vue/24/outline";

withDefaults(
  defineProps<{
    name: string;
    asIcon?: boolean;
  }>(),
  { asIcon: false },
);

const emit = defineEmits<{ (event: "remove"): void }>();

const open = ref(false);

function confirm() {
  open.value = false;
  emit("remove");
}
</script>
