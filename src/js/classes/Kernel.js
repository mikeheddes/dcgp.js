import { DCGP_TYPES } from '../constants'
import {
  setInHEAP,
  encodeStringArray,
  decodeString,
  getExportsFactory,
  flatten2D,
  transpose2D,
} from '../helpers'
import { getInstance } from '../initialiser'

function structureEvaluationInputs(type, inputs) {
  if (Array.isArray(inputs[0])) {
    if (type === 'gdual_v') {
      return flatten2D(inputs)
    } else {
      return flatten2D(transpose2D(inputs))
    }
  }

  return inputs
}

// TODO: refactor function
function calculateEvaluation({ type, inputs, inputPointer, evaluate }) {
  const {
    exports: { _delete_double_array },
    memory: { F64 },
  } = getInstance()

  const outputs = 1
  const numInputs = inputs.length

  if (Array.isArray(inputs[0])) {
    const inputArrayLength = inputs[0].length

    if (type === 'gdual_v') {
      const resultPointer = evaluate(inputPointer, numInputs, inputArrayLength)

      const typedResults = new Float64Array(
        F64.buffer,
        resultPointer,
        outputs * inputArrayLength
      )

      const result = Array.from(typedResults)

      _delete_double_array(resultPointer)

      return result
    } else {
      const results = []
      const lengthOfInput = 1

      for (let i = 0; i < inputArrayLength; i++) {
        const result = evaluate(
          inputPointer + i * inputs.length * F64.BYTES_PER_ELEMENT,
          numInputs,
          lengthOfInput
        )

        results.push(result)
      }

      return results
    }
  } else {
    const lengthOfInput = 1
    let result

    if (type === 'gdual_v') {
      const resultPointer = evaluate(inputPointer, numInputs, lengthOfInput)

      result = F64[resultPointer / F64.BYTES_PER_ELEMENT]

      _delete_double_array(resultPointer)
    } else {
      result = evaluate(inputPointer, numInputs)
    }

    return result
  }
}

/**
 * @class
 * @property {string} name
 * @param {(...number) => number} operatorFunction Function calculating the result of the kernel.
 * @param {(...string) => string} stringFunction Function creating the equation of the kernel.
 * @param {string} name Name of the Kernel.
 * @param {number} [pointer] Pointer to an existing Kernel in memory.
 * @param {('double'|'gdual_d'|'gdual_v')} [type='double']
 */
class Kernel {
  constructor(
    operatorFunction,
    stringFunction,
    name,
    pointer = null,
    type = 'double'
  ) {
    if (DCGP_TYPES.indexOf(type) === -1) {
      throw `Expression type '${type}' is invalid. Must be one of ${DCGP_TYPES}`
    }

    const getExports = getExportsFactory.bind(null, 'kernel', type)

    Object.defineProperties(this, {
      type: { value: type },
      getExports: { value: getExports },
    })

    if (pointer) {
      const {
        exports: { _delete_string },
        memory: { U8 },
      } = getInstance()

      const [getName] = getExports('name')

      Object.defineProperty(this, 'pointer', { value: pointer })

      const namePointer = getName(this.pointer)

      const name = decodeString(U8, namePointer)

      Object.defineProperty(this, 'name', { value: name })

      _delete_string(namePointer)
      return
    }

    // When compiling with optimizations (e.g. -O3) this functionality breaks.
    // Without comiler optimalizations (-O0) the commented out code works and
    // can be used to creat a kernel with a custom JS function.
    throw 'Initializing a kernel with JavaScript functions is not supported.' +
      'For now the Kernel can only be constructed with a pointer.'

    /*
    const wrappedOperationFunc = (arrayPointer, length) => {
      const inputArray = new Float64Array(HEAPF64.buffer, arrayPointer, length);

      return operatorFunction(inputArray);
    };

    const wrappedStringFunc = (arrayPointer, lengthsPointer, length, outputPointer) => {
      const lengthsArray = new Uint16Array(
        HEAPU16.buffer,
        lengthsPointer,
        length
      );

      const inputArray = new Array(length);
      let shifted = 0;

      for (let index = 0; index < length; index++) {
        const textIntArray = new Uint8Array(
          HEAPU8.buffer,
          shifted + arrayPointer,
          lengthsArray[index]
        );

        inputArray[index] = decoder.decode(textIntArray);
        shifted += lengthsArray[index];
      }

      const result = stringFunction(inputArray);
      const resultIntArray = encoder.encode(result + '\0');
      setInHEAP(HEAPU8, resultIntArray, outputPointer);
    };

    // This can cause an error based on the RESERVED_FUNCTION_POINTERS compile setting
    const operationPointer = addFunction(wrappedOperationFunc);
    const printPointer = addFunction(wrappedStringFunc);

    Object.defineProperty(this, "functionPointers", {
      value: [operationPointer, printPointer]
    });

    const nameIntArray = encoder.encode(name + '\0');
    const namePointer = stackAlloc(nameIntArray.byteLength);
    setInHEAP(HEAPU8, nameIntArray, namePointer);

    const receivedPointer = _embind_kernel_0(
      operationPointer,
      printPointer,
      namePointer,
      nameIntArray.length
    );

    Object.defineProperty(this, "pointer", { value: receivedPointer });
    Object.defineProperty(this, "name", { value: name });

    stackRestore(stackStart);
    */
  }

  /**
   * Calculates the result of the kernel with `inputs`.
   *
   * @memberof Kernel
   * @param {...(number|[number])} inputs Input to the kernel. Must be at least two.
   * @returns {(number|[number])} The output of the kernel.
   * @example
   * kernel.evalutate(1, 2, 3)
   * // could for example return 2
   * @example
   * kernel.evalutate([1, 4], [2, 5], [3, 6])
   * // could for example return [3, 2]
   */
  evaluate(...inputs) {
    if (inputs.length < 2) {
      throw 'Must at least provide two inputs'
    }

    if (!inputs.every(i => typeof i === 'number' || Array.isArray(i))) {
      throw 'Every entry of inputs must be a number or an array with numbers'
    }

    const {
      exports: { stackSave, stackAlloc, stackRestore },
      memory: { F64 },
    } = getInstance()

    const [evaluate] = this.getExports('evaluate')

    const stackStart = stackSave()

    const inputArray = structureEvaluationInputs(this.type, inputs)

    const inputArrayF64 = new Float64Array(inputArray)
    const inputPointer = stackAlloc(inputArrayF64.byteLength)
    setInHEAP(F64, inputArrayF64, inputPointer)

    const result = calculateEvaluation({
      type: this.type,
      inputs,
      inputPointer,
      evaluate: evaluate.bind(null, this.pointer),
    })

    stackRestore(stackStart)

    return result
  }

  /**
   * Gets the eqution that is represended by the kernel.
   *
   * @memberof Kernel
   * @param {...string} inputSymbols Symbol for the inputs of the kernel. Must be at least two.
   * @returns {string} Array with with the equation for every output of the kernel.
   * @example
   * kernel.equation('a', 'b')
   * // could for example return ['(a+b)']
   */
  equation(...inputSymbols) {
    if (inputSymbols.length < 2) {
      throw 'Must at least provide 2 inputSymbols'
    }

    if (!inputSymbols.every(i => typeof i === 'string')) {
      throw 'Every entry of inputSymbols must be a string'
    }

    const {
      exports: { stackSave, stackAlloc, stackRestore, _delete_string },
      memory: { U8 },
    } = getInstance()

    const [equation] = this.getExports('equation')

    const stackStart = stackSave()

    const encodedStrings = encodeStringArray(inputSymbols)

    const stringsPointer = stackAlloc(encodedStrings.byteLength)
    setInHEAP(U8, encodedStrings, stringsPointer)

    const resultPointer = equation(
      this.pointer,
      stringsPointer,
      inputSymbols.length
    )

    const result = decodeString(U8, resultPointer)

    _delete_string(resultPointer)
    stackRestore(stackStart)

    return result
  }

  /**
   * Get a string representation of the Kernel.
   * @memberof Kernel
   * @returns {string} The name of the Kernel.
   */
  toString() {
    return this.name
  }

  /**
   * Removes the C++ object from memory.
   * @memberof Kernel
   */
  destroy() {
    const [destroy] = this.getExports('destroy')

    // Use this to remove the custom functions if used.
    // See comment at constructor for more info.
    // if (this.functionPointers) {
    //   this.functionPointers.forEach(pointer => {
    //     removeFunction(pointer);
    //   });
    // }

    destroy(this.pointer)
  }
}

export default Kernel