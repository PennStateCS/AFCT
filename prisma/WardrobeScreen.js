import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Dropdown } from "react-native-element-dropdown";
import {
  getClothingItems,
  addClothingItem,
  updateClothingItem,
  deleteClothingItem,
} from "../utils/storage";
import AddItemModal from "../components/AddItemModal";
import ClothingItemCard from "../components/ClothingItemCard";
import { CATEGORIES, SEASONS } from "../utils/constants";

export default function WardrobeScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [season, setSeason] = useState("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);

  const categoryOptions = [
    { label: "All Categories", value: "all" },
    ...CATEGORIES.map((c) => ({
      label: c.charAt(0).toUpperCase() + c.slice(1),
      value: c,
    })),
  ];

  const seasonOptions = [
    { label: "All Seasons", value: "all" },
    ...SEASONS.map((s) => ({
      label: s.charAt(0).toUpperCase() + s.slice(1),
      value: s,
    })),
  ];

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const data = await getClothingItems();
      setItems(data);
      setLoading(false);
    };
    const unsub = setInterval(load, 400);
    load();
    return () => clearInterval(unsub);
  }, []);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      const s = search.toLowerCase();
      const bySearch =
        it.name.toLowerCase().includes(s) ||
        (it.color || "").toLowerCase().includes(s) ||
        (it.brand || "").toLowerCase().includes(s);
      const byCat = category === "all" || it.category === category;
      const bySeason = season === "all" || it.season === season;
      return bySearch && byCat && bySeason;
    });
  }, [items, search, category, season]);

  const onSaveItem = async (formOrUpdated) => {
    if (editing) {
      await updateClothingItem(formOrUpdated);
      setEditing(null);
    } else {
      await addClothingItem(formOrUpdated);
    }
    setModalOpen(false);
    setItems(await getClothingItems());
  };

  const onDelete = (id) => {
    Alert.alert("Delete", "Remove this item?", [
      { text: "Cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteClothingItem(id);
          setItems(await getClothingItems());
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Wardrobe</Text>

      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search items by name, color, brand..."
        placeholderTextColor="#999"
        style={styles.input}
      />

      {/* Dropdown Filters */}
      <View style={styles.dropdownRow}>
        <View style={styles.dropdownContainer}>
          <Dropdown
            style={styles.dropdown}
            data={categoryOptions}
            labelField="label"
            valueField="value"
            value={category}
            onChange={(item) => setCategory(item.value)}
            placeholder="Select Category"
            placeholderStyle={styles.placeholderStyle}
            selectedTextStyle={styles.selectedTextStyle}
          />
        </View>

        <View style={styles.dropdownContainer}>
          <Dropdown
            style={styles.dropdown}
            data={seasonOptions}
            labelField="label"
            valueField="value"
            value={season}
            onChange={(item) => setSeason(item.value)}
            placeholder="Select Season"
            placeholderStyle={styles.placeholderStyle}
            selectedTextStyle={styles.selectedTextStyle}
          />
        </View>
      </View>

      <TouchableOpacity
        onPress={() => {
          setEditing(null);
          setModalOpen(true);
        }}
        style={styles.addBtn}
      >
        <Text style={{ color: "#fff", fontWeight: "700" }}>+ Add</Text>
      </TouchableOpacity>

      {loading ? (
        <ActivityIndicator
          size="large"
          color="#6a5acd"
          style={{ marginTop: 20 }}
        />
      ) : filtered.length === 0 ? (
        <Text style={{ color: "#666", marginTop: 16 }}>No items found.</Text>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => (
            <ClothingItemCard
              item={item}
              onEdit={(it) => {
                setEditing(it);
                setModalOpen(true);
              }}
              onDelete={onDelete}
            />
          )}
          contentContainerStyle={{ paddingBottom: 32 }}
        />
      )}

      <AddItemModal
        visible={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={onSaveItem}
        editItem={editing}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f8f6ff",
    padding: 16,
    paddingTop: 50,
  },
  header: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 16,
  },
  input: {
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ddd",
    padding: 12,
    marginBottom: 10,
    color: "#333",
  },
  dropdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 8,
  },
  dropdownContainer: { flex: 1 },
  dropdown: {
    height: 48,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    paddingHorizontal: 8,
  },
  placeholderStyle: { color: "#999" },
  selectedTextStyle: { color: "#333" },
  addBtn: {
    backgroundColor: "#6a5acd",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignSelf: "flex-end",
    marginBottom: 10,
  },
});
