print("## --- VENTANA DESLIZANTE (SLICE-WINDOW) ---")
def slice_window(a):
    """
    Calculates a new list where each element at index i is the sum of
    a[i-1], a[i], and a[i+1] (if those indices exist).
    """
    # Determine the total number of elements in the input list
    n = len(a)

    # Handle the edge case of an empty input to prevent processing errors
    if n == 0:
        return []

    # Create a result list 'z' pre-filled with zeros. This avoids dynamic
    # resizing and improves memory efficiency during the iteration.
    z = [0] * n

    # Iterate through each index in the list to calculate local window sums
    for i in range(n):
        # Start the sum with the current element at the center of the window
        val = a[i]

        # Check if a left-hand neighbor exists (index > 0)
        if i > 0:
            # Include the predecessor in the current window sum
            val += a[i - 1]

        # Check if a right-hand neighbor exists (index is not the last)
        if i < n - 1:
            # Include the successor in the current window sum
            val += a[i + 1]

        # Store the computed three-point sum into the result array
        z[i] = val

    return z

# Test the function with a simple identity array
arrays = [1, 1, 1]
result = slice_window(arrays)

print(f"InputLote1:  {arrays}")
print(f"OutputLote1: {result}")
print("## ------------------------------")

print("## ---------TRANSVERSAL----------")

def transversal_solution(b):
        # Determine length to initialize the parallel output array
        x = len(b)
        # 'y' will store the transversal sums for each corresponding index in 'b'
        y = [0] * x

        for i in range(x):
            # Using inline conditional expressions (ternary) to handle boundaries:
            # If the index is valid for the left neighbor, fetch it; otherwise, use 0.
            z1 = b[i-1] if i > 0 else 0

            # The current element is always present within the loop range.
            z2 = b[i]

            # If the index is valid for the right neighbor, fetch it; otherwise, use 0.
            z3 = b[i+1] if i < x - 1 else 0

            # Consolidate the three neighborhood values into a single sum.
            y[i] = (z1 + z2 + z3)

        return y

test_input2 = [1, 1, 1, 1]
print(f"InputLote2:  {test_input2}")
print(f"OutputLote2: {transversal_solution(test_input2)}")

print("## ------------------------------")

print("## --- SUMA Y MAPEADO (SUM-&-MAPPING) ---")

def sum_and_mapping_solution(c):
    # The code calculates the length of the input list a and stores it in the variable n
    n = len(c)

    # checks if the input list is empty. If it is, the function immediately returns an empty list.
    if n == 0:
        return []

    # Initialize the output array pre-allocates a list of a fixed size (n).
    # Python reserves a contiguous block of memory for the entire array at once.
    # Using 0 as a placeholder ensures that every index in the array is valid.
    # ... and has a default value before the logic in the for loop begins populating
    # ... it with the actual sums.
    b = [0] * n

    # Pre-define boundaries logic
    # The first and last elements are handled specifically or through logical checks
    # to maintain a clean, high-performance loop.
    for i in range(n):

        # Starts by taking the value of the element at the current position $i$.
        val = c[i]

        # If you aren't at the very first element.
        if i > 0:
            # the value of the neighbor to the left is added to the total
            val += c[i - 1]

        # If you aren't at the very last element
        if i < n - 1:
            # the value of the neighbor to the right is added.
            val += c[i + 1]

        # Once all neighbors for that specific index have been checked and added,
        # the final sum stored in val is saved into the corresponding slot
        # in your result array b.
        b[i] = val

    return b

# Test cases
test_inputs = [
    [],
    [1],
    [5],
    [1,1],
    [1, 1, 1],
    [1, 2, 3, 4],
    [10, 20, 30],
    [1, 2, 3, 4, 5]
]

for t in test_inputs:
    print(f"Input: {t} -> Output: {sum_and_mapping_solution(t)}")
